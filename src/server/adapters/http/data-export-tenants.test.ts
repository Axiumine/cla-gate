// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { seedSignatures } from '../../services/export/export-fixture/test-support.ts';
import { seedAllowlist, seedAudit } from '../../services/export/own-data-fixture/test-support.ts';
import { eraseSigner } from '../../services/signer-erasure.ts';
import { exportAuditRows, exportWorld } from './data-export-fixture/test-support.ts';

// The export of a person's own data across tenants and between people (E16-S06): everything the person holds in every tenant is in
// their document, and nothing of another person is. The person is not a member of any tenant, so no role is asked for.

const ONE_PII = { login: 'sentinel-one', name: 'Sentinel One', email: 'one@sentinel.example' };
const TWO_PII = { login: 'sentinel-two', name: 'Sentinel Two', email: 'two@sentinel.example' };

/**
 * The matrix world where `member1` (the signer of tenant 1) has also signed in tenant 2 and `admin2` (the signer of tenant 2)
 * in tenant 1, each with a sentinel in the personal data of the second signature, an allowlist entry and an audit row of
 * their own in each tenant, and rows that name the other.
 */
async function crossed() {
  const state = await exportWorld();
  const { db, people, t1, t2 } = state;
  const [one] = await seedSignatures(db, t2, [{ githubId: people.member1.githubId, pii: ONE_PII, signedAtMs: 1000 }]);
  const [two] = await seedSignatures(db, t1, [{ githubId: people.admin2.githubId, pii: TWO_PII, signedAtMs: 2000 }]);
  await seedAllowlist(db, [
    { tenant: t1, githubId: people.member1.githubId, createdAtMs: 1000 },
    { tenant: t2, githubId: people.member1.githubId, createdAtMs: 2000 },
    { tenant: t1, githubId: people.admin2.githubId, createdAtMs: 3000 },
    { tenant: t2, githubId: people.admin2.githubId, createdAtMs: 4000 },
  ]);
  await seedAudit(db, [
    {
      action: 'signature.created',
      installationId: t1.installationId,
      actorGithubId: people.member1.githubId,
      atMs: 1000,
    },
    {
      action: 'signature.created',
      installationId: t2.installationId,
      actorGithubId: people.member1.githubId,
      atMs: 2000,
    },
    {
      action: 'signature.created',
      installationId: t1.installationId,
      actorGithubId: people.admin2.githubId,
      atMs: 3000,
    },
    {
      action: 'signature.created',
      installationId: t2.installationId,
      actorGithubId: people.admin2.githubId,
      atMs: 4000,
    },
    {
      action: 'signer_pii.erased',
      installationId: t1.installationId,
      actorGithubId: people.admin1.githubId,
      atMs: 5000,
      subject: { type: 'user', id: people.admin2.githubId },
    },
  ]);
  return { ...state, one: one ?? 0, two: two ?? 0 };
}

test('the document holds the signatures of the person in every tenant and the signatures of nobody else', async () => {
  const { db, exported, one, two, people, t1, t2 } = await crossed();
  const first = await exported('member1');
  const second = await exported('admin2');
  expect(first.signatures.map((signature) => signature.id).toSorted((a, b) => a - b)).toEqual([t1.signatureId, one]);
  expect(second.signatures.map((signature) => signature.id).toSorted((a, b) => a - b)).toEqual([t2.signatureId, two]);
  const owned = await db.selectFrom('signatures').select('id').where('user_id', '=', people.member1.userId).execute();
  expect(owned.map((row) => row.id).toSorted((a, b) => a - b)).toEqual([t1.signatureId, one]);
  expect(
    first.signatures.map((signature) => signature.installation.accountLogin).toSorted((a, b) => a.localeCompare(b)),
  ).toEqual(['org-1', 'org-2']);
});

test("user 1's document contains none of user 2's signatures, personal data, audit entries or allowlist entries, and the reverse", async () => {
  const { get } = await crossed();
  const first = (await get('member1')).body;
  const second = (await get('admin2')).body;
  for (const hers of [
    'Sentinel Two',
    'two@sentinel.example',
    'sentinel-two',
    'Name 31002',
    'u31002@example.test',
    'login-31002',
  ]) {
    expect(first, `the document of member1 holds ${hers}`).not.toContain(hers);
  }
  for (const his of [
    'Sentinel One',
    'one@sentinel.example',
    'sentinel-one',
    'Name 31004',
    'u31004@example.test',
    'login-31004',
  ]) {
    expect(second, `the document of admin2 holds ${his}`).not.toContain(his);
  }
});

test('the allowlist entries and the audit entries of the document are the ones that name the person, whichever tenant they are in', async () => {
  const { exported, people, t1, t2 } = await crossed();
  const first = await exported('member1');
  expect(first.allowlistEntries.map((entry) => entry.installation.accountLogin)).toEqual(['org-2', 'org-1']);
  expect(first.auditEntries.map((entry) => entry.installationId)).toEqual([
    t2.githubInstallationId,
    t1.githubInstallationId,
  ]);
  const second = await exported('admin2');
  expect(second.allowlistEntries.map((entry) => entry.installation.accountLogin)).toEqual(['org-2', 'org-1']);
  expect(second.auditEntries.map((entry) => [entry.action, entry.installationId, entry.subject?.id ?? null])).toEqual([
    ['signer_pii.erased', t1.githubInstallationId, people.admin2.githubId],
    ['signature.created', t2.githubInstallationId, null],
    ['signature.created', t1.githubInstallationId, null],
  ]);
});

test('a person with no data has a document with empty arrays and an audit row that counts none', async () => {
  const { db, exported, people } = await exportWorld();
  const document = await exported('outsider');
  expect(document).toMatchObject({
    user: { githubId: people.outsider.githubId, login: `login-${people.outsider.githubId}` },
    signatures: [],
    allowlistEntries: [],
    auditEntries: [],
    truncated: false,
  });
  expect(await exportAuditRows(db)).toEqual([expect.objectContaining({ metadata: { signature_count: 0 } })]);
});

test('an administrator exports their own data and no more: the role of an org admin gives no one else', async () => {
  const { exported, people } = await crossed();
  const document = await exported('admin1');
  expect(document.user.githubId).toBe(people.admin1.githubId);
  expect(document.signatures).toEqual([]);
  expect(document.auditEntries).toEqual([
    expect.objectContaining({ action: 'signer_pii.erased', subject: { type: 'user', id: 31_002 } }),
  ]);
});

test('after the erasure of one tenant the signatures there show no personal data and the other tenant still does', async () => {
  const { db, exported, people, t1 } = await crossed();
  await eraseSigner(
    db,
    { installationId: t1.installationId },
    { githubUserId: people.member1.githubId, expectedRows: 1, actor: parseGithubId(people.admin1.githubId) },
  );
  const document = await exported('member1');
  expect(
    document.signatures.map((signature) => [signature.installation.accountLogin, signature.personalData === null]),
  ).toEqual([
    ['org-1', true],
    ['org-2', false],
  ]);
  expect(document.signatures[1]?.personalData).toMatchObject({ name: 'Sentinel One' });
  expect(document.auditEntries.map((entry) => entry.action)).toContain('signer_pii.erased');
});
