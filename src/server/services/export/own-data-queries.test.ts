// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { twoTenants } from '../../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase } from '../../adapters/db/test-support.ts';
import { seedSignatures } from './export-fixture/test-support.ts';
import { seedAllowlist, seedAudit } from './own-data-fixture/test-support.ts';
import { ownAllowlistEntries, ownAuditEntries } from './own-data-queries.ts';
import { ownSignatures } from './own-signatures-query.ts';

// The statements of the export of a person's own data (E16-S06): ownSignatures, ownAllowlistEntries and ownAuditEntries. Each
// one names the person's own key, reads every tenant and takes nothing else from the caller. The route and the document are
// in adapters/http/data-export-*.test.ts.

const REVOKER = 1001;
const PERSON = parseGithubId(8800);
const OTHER = parseGithubId(8801);

async function world() {
  const { db } = await migratedTestDatabase();
  const tenants = await twoTenants(db);
  return { db, ...tenants };
}

const userIdOf = async (db: Awaited<ReturnType<typeof world>>['db'], githubId: number): Promise<number> =>
  (await db.selectFrom('users').select('id').where('github_id', '=', githubId).executeTakeFirstOrThrow()).id;

test('ownSignatures: the person has a row for every signature in every tenant, newest first and by id within one instant, and nobody else has one', async () => {
  const { db, t1, t2 } = await world();
  const [first, second] = await seedSignatures(db, t1, [
    { githubId: PERSON, signedAtMs: 1000 },
    { githubId: OTHER, signedAtMs: 1000 },
  ]);
  const [third, fourth] = await seedSignatures(db, t2, [
    { githubId: PERSON, signedAtMs: 1000, revoked: { afterMs: 1, byGithubId: REVOKER, reason: 'other' } },
    { githubId: PERSON, signedAtMs: 2000, pii: null },
  ]);
  const rows = await ownSignatures(db, await userIdOf(db, PERSON));
  expect(rows.map((row) => row.id)).toEqual([fourth, third, first]);
  expect(rows.map((row) => row.id)).not.toContain(second);
  expect(rows.map((row) => [row.github_installation_id, row.account_login])).toEqual([
    [t2.githubInstallationId, 'org-2'],
    [t2.githubInstallationId, 'org-2'],
    [t1.githubInstallationId, 'org-1'],
  ]);
});

test('ownSignatures: a row carries the document, the version, the source and the revocation, and no row names who revoked', async () => {
  const { db, t1 } = await world();
  const [id] = await seedSignatures(db, t1, [
    { githubId: PERSON, revoked: { afterMs: 5000, byGithubId: REVOKER, reason: 'legal_request' }, prNumber: 31 },
  ]);
  const [row] = await ownSignatures(db, await userIdOf(db, PERSON));
  expect(row).toEqual({
    id,
    github_installation_id: t1.githubInstallationId,
    account_login: 'org-1',
    document_id: t1.documentId,
    document_name: 'Individual CLA',
    version_id: t1.versionId,
    major: 1,
    minor: 0,
    content_sha256: t1.contentSha256,
    consent_text_id: 'consent-v1',
    signer_type: 'individual',
    signed_at: new Date('2026-10-15T09:00:00.000Z'),
    source_repository: 'org-1/repo',
    source_pr_number: 31,
    revoked_at: new Date('2026-10-15T09:00:05.000Z'),
    revoke_reason: 'legal_request',
    personal_data: {
      name: `Name ${PERSON}`,
      email: `u${PERSON}@example.test`,
      login: `login-${PERSON}`,
      ip_address: null,
      user_agent: null,
    },
  });
});

test('ownSignatures: the personal data is null once it was erased, and a signature from no repository has no source', async () => {
  const { db, t1 } = await world();
  await seedSignatures(db, t1, [{ githubId: PERSON, pii: null, repositoryId: null }]);
  const [row] = await ownSignatures(db, await userIdOf(db, PERSON));
  expect(row).toMatchObject({ personal_data: null, source_repository: null, source_pr_number: null });
});

test('ownSignatures: a user id that signed nothing has no row, and the signers of the two tenants each have their own', async () => {
  const { db, t1, t2 } = await world();
  expect(await ownSignatures(db, 987_654)).toEqual([]);
  expect((await ownSignatures(db, t1.signer.userId)).map((row) => row.id)).toEqual([t1.signatureId]);
  expect((await ownSignatures(db, t2.signer.userId)).map((row) => row.id)).toEqual([t2.signatureId]);
});

test('ownAllowlistEntries: the entries that name the person in every tenant, newest first and by id within one instant, with their kind and scope', async () => {
  const { db, t1, t2 } = await world();
  await seedAllowlist(db, [
    { tenant: t1, githubId: PERSON, createdAtMs: 1000 },
    { tenant: t2, githubId: OTHER, createdAtMs: 9000 },
    { tenant: t2, githubId: PERSON, kind: 'bot', repositoryId: t2.plain.repositoryId, createdAtMs: 1000 },
    { tenant: t1, githubId: PERSON, kind: 'org_members', createdAtMs: 500 },
  ]);
  const rows = await ownAllowlistEntries(db, PERSON);
  expect(rows.map((row) => [row.account_login, row.repository_id === null, row.kind])).toEqual([
    ['org-2', false, 'bot'],
    ['org-1', true, 'user'],
    ['org-1', true, 'org_members'],
  ]);
  expect(rows[0]?.created_at).toEqual(new Date('2026-10-15T09:00:01.000Z'));
  expect(await ownAllowlistEntries(db, parseGithubId(1))).toEqual([]);
});

test('ownAuditEntries: the rows where the person is the actor, or the subject of a user row, and no row where only the number is the same', async () => {
  const { db, t1, t2 } = await world();
  await seedAudit(db, [
    { action: 'a.actor', installationId: t1.installationId, actorGithubId: PERSON, atMs: 1000 },
    {
      action: 'a.subject',
      installationId: t2.installationId,
      actorGithubId: REVOKER,
      atMs: 2000,
      subject: { type: 'user', id: PERSON },
    },
    {
      action: 'a.both',
      installationId: null,
      actorGithubId: PERSON,
      atMs: 3000,
      subject: { type: 'user', id: PERSON },
    },
    {
      action: 'a.other_type',
      installationId: t1.installationId,
      actorGithubId: REVOKER,
      atMs: 4000,
      subject: { type: 'signature', id: PERSON },
    },
    {
      action: 'a.other_user',
      installationId: t1.installationId,
      actorGithubId: PERSON + 1,
      atMs: 5000,
      subject: { type: 'user', id: OTHER },
    },
    { action: 'a.system', installationId: t1.installationId, actorGithubId: null, atMs: 6000 },
  ]);
  const rows = await ownAuditEntries(db, PERSON, 10);
  expect(rows.map((row) => row.action)).toEqual(['a.both', 'a.subject', 'a.actor']);
  expect(rows.map((row) => row.github_installation_id)).toEqual([
    null,
    t2.githubInstallationId,
    t1.githubInstallationId,
  ]);
  expect(rows.map((row) => [row.subject_type, row.subject_id])).toEqual([
    ['user', PERSON],
    ['user', PERSON],
    [null, null],
  ]);
});

test.each([
  [0, []],
  [2, ['a.e5', 'a.e4']],
  [10, ['a.e5', 'a.e4', 'a.e3', 'a.e2', 'a.e1']],
])('ownAuditEntries: with a limit of %i the newest rows are returned, ties by id', async (limit, expected) => {
  const { db, t1 } = await world();
  await seedAudit(
    db,
    [1, 2, 3, 4, 5].map((n) => ({
      action: `a.e${n}`,
      installationId: t1.installationId,
      actorGithubId: PERSON,
      atMs: n === 4 ? 3000 : n * 1000,
    })),
  );
  const rows = await ownAuditEntries(db, PERSON, limit);
  expect(rows.map((row) => row.action)).toEqual(expected);
});
