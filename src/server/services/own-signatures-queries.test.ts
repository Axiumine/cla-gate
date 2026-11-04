// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import { activateMajor, seedInstant, seedSignatures } from './export/export-fixture/test-support.ts';
import {
  ADA,
  addRepository,
  BOB,
  enforceDocument,
  seedWithinOneMillisecond,
  twoSeededTenants,
  userIdOf,
} from './own-signatures-fixture/test-support.ts';
import { type OwnSignaturePosition, ownSignatureRows } from './own-signatures-queries.ts';

// The statement behind the list of a person's own signatures (E13-S06): ownSignatureRows. It names the person's own key and
// nothing else, so it reads every tenant and never another person's row; the order, the place a page starts at and what a row
// carries are shown here. The route is in adapters/http/own-signatures-*.test.ts, and the tenant matrix of the registry calls the
// statement for two tenants as well.

const FIRST_PAGE = { limit: 50, from: null };

async function world() {
  const { db } = await migratedTestDatabase();
  return { db, ...(await twoSeededTenants(db)) };
}

test('the person has a row for every signature in every tenant, newest first and by id within one instant, and nobody else has one', async () => {
  const { db, t1, t2 } = await world();
  const [first, theirs] = await seedSignatures(db, t1, [
    { githubId: ADA, signedAtMs: 1000 },
    { githubId: BOB, signedAtMs: 1000 },
  ]);
  const [tied, latest] = await seedSignatures(db, t2, [
    { githubId: ADA, signedAtMs: 1000, revoked: { afterMs: 1, byGithubId: BOB, reason: 'other' } },
    { githubId: ADA, signedAtMs: 2000, pii: null },
  ]);
  const rows = await ownSignatureRows(db, await userIdOf(db, ADA), FIRST_PAGE);
  expect(rows.map((row) => row.id)).toEqual([latest, tied, first]);
  expect(rows.map((row) => row.id)).not.toContain(theirs);
  expect(rows.map((row) => row.accountLogin)).toEqual(['org-2', 'org-2', 'org-1']);
});

test('a row carries the installation, the document, the version, the source and the revocation, and nothing of the personal data or of who revoked', async () => {
  const { db, t1 } = await world();
  const [id] = await seedSignatures(db, t1, [
    {
      githubId: ADA,
      signedAtMs: 0,
      revoked: { afterMs: 5000, byGithubId: BOB, reason: 'legal_request' },
      prNumber: 31,
    },
  ]);
  const [row] = await ownSignatureRows(db, await userIdOf(db, ADA), FIRST_PAGE);
  expect(row).toEqual({
    id,
    major: 1,
    signedAt: seedInstant(0),
    revokedAt: seedInstant(5000),
    prNumber: 31,
    accountLogin: 'org-1',
    accountType: 'Organization',
    suspendedAt: null,
    documentId: t1.documentId,
    documentName: 'Individual CLA',
    activeMajor: 1,
    versionId: t1.versionId,
    minor: 0,
    sourceFullName: 'org-1/repo',
    sourceGithubRepoId: 9000,
    sourceRemovedAt: null,
    signedAtMicros: '2026-10-15T09:00:00.000000Z',
    documentGithubRepoId: null,
  });
  expect(Object.keys(row ?? {})).not.toEqual(expect.arrayContaining(['name', 'email', 'revoke_reason', 'revoked_by']));
});

test('the major in force is the one of the active version of the document, and none while it has no active version', async () => {
  const { db, t1, t2 } = await world();
  await seedSignatures(db, t1, [{ githubId: ADA, signedAtMs: 1000 }]);
  await seedSignatures(db, t2, [{ githubId: ADA, signedAtMs: 2000 }]);
  await activateMajor(db, t1, 3);
  await db.updateTable('cla_documents').set({ active_version_id: null }).where('id', '=', t2.documentId).execute();
  const rows = await ownSignatureRows(db, await userIdOf(db, ADA), FIRST_PAGE);
  expect(rows.map((row) => [row.accountLogin, row.major, row.activeMajor])).toEqual([
    ['org-2', 1, null],
    ['org-1', 1, 3],
  ]);
});

test('a row names the lowest repository that enforces the document and is still listed, in the tenant of the document only', async () => {
  const { db, t1, t2 } = await world();
  await seedSignatures(db, t1, [{ githubId: ADA, signedAtMs: 1000 }]);
  await enforceDocument(db, t1);
  await addRepository(db, t1, { githubRepoId: 4000, enforcesDocument: true });
  await addRepository(db, t1, { githubRepoId: 3000, enforcesDocument: true, removed: true });
  await addRepository(db, t1, { githubRepoId: 2000, enforcesDocument: false });
  await enforceDocument(db, t2);
  await addRepository(db, t2, { githubRepoId: 10, enforcesDocument: true });
  const [row] = await ownSignatureRows(db, await userIdOf(db, ADA), FIRST_PAGE);
  expect(row?.documentGithubRepoId).toBe(4000);
  expect(row?.sourceGithubRepoId).toBe(9000);
});

test('the source repository comes with the instant GitHub stopped listing it, and a signature with no source has none', async () => {
  const { db, t1 } = await world();
  await seedSignatures(db, t1, [
    { githubId: ADA, signedAtMs: 1000, repositoryId: null },
    { githubId: ADA, signedAtMs: 2000, revoked: { afterMs: 1, byGithubId: BOB, reason: 'other' } },
  ]);
  await db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', t1.repositoryId)
    .execute();
  const [removed, none] = await ownSignatureRows(db, await userIdOf(db, ADA), FIRST_PAGE);
  expect(removed).toMatchObject({ sourceFullName: 'org-1/repo', sourceRemovedAt: new Date('2026-10-01T00:00:00Z') });
  expect(none).toMatchObject({ sourceFullName: null, sourceGithubRepoId: null, sourceRemovedAt: null, prNumber: null });
});

test('a page holds one row more than asked for, so the caller can tell that another follows', async () => {
  const { db, t1 } = await world();
  await seedSignatures(
    db,
    t1,
    [1, 2, 3].map((n) => ({
      githubId: ADA,
      signedAtMs: n * 1000,
      revoked: { afterMs: 1, byGithubId: BOB, reason: 'other' },
    })),
  );
  const userId = await userIdOf(db, ADA);
  expect(await ownSignatureRows(db, userId, { limit: 2, from: null })).toHaveLength(3);
  expect(await ownSignatureRows(db, userId, { limit: 3, from: null })).toHaveLength(3);
  expect(await ownSignatureRows(db, userId, { limit: 1, from: null })).toHaveLength(2);
});

test('a page starts at the row of its place, the place itself included, and goes on in the order of the list', async () => {
  const { db, t1 } = await world();
  const ids = await seedSignatures(
    db,
    t1,
    [1, 2, 3, 4].map((n) => ({
      githubId: ADA,
      signedAtMs: Math.ceil(n / 2) * 1000,
      revoked: { afterMs: 1, byGithubId: BOB, reason: 'other' },
    })),
  );
  const userId = await userIdOf(db, ADA);
  const all = await ownSignatureRows(db, userId, FIRST_PAGE);
  expect(all.map((row) => row.id)).toEqual([ids[3], ids[2], ids[1], ids[0]]);
  const second = all[1];
  const rows = await ownSignatureRows(db, userId, {
    limit: 50,
    from: { signedAt: second?.signedAtMicros ?? '', id: second?.id ?? 0 },
  });
  expect(rows.map((row) => row.id)).toEqual([ids[2], ids[1], ids[0]]);
});

test('the place keeps the microsecond: signatures of one millisecond are told apart and none is skipped or repeated', async () => {
  const { db, t1 } = await world();
  const ids = await seedWithinOneMillisecond(db, t1, ADA, [100, 300, 200]);
  const userId = await userIdOf(db, ADA);
  const all = await ownSignatureRows(db, userId, FIRST_PAGE);
  expect(all.map((row) => row.id)).toEqual([ids[1], ids[2], ids[0]]);
  expect(all.map((row) => row.signedAtMicros)).toEqual([
    '2026-10-15T09:00:00.123300Z',
    '2026-10-15T09:00:00.123200Z',
    '2026-10-15T09:00:00.123100Z',
  ]);
  const seen: number[] = [];
  let from: OwnSignaturePosition | null = null;
  for (let page = 0; page < 3; page += 1) {
    const rows = await ownSignatureRows(db, userId, { limit: 1, from });
    seen.push(...rows.slice(0, 1).map((row) => row.id));
    const following = rows[1];
    from = following === undefined ? null : { signedAt: following.signedAtMicros, id: following.id };
  }
  expect(seen).toEqual([ids[1], ids[2], ids[0]]);
  expect(from).toBeNull();
});

test('a person with no signature has no row, and so has a place after the last one', async () => {
  const { db, t1 } = await world();
  await seedSignatures(db, t1, [{ githubId: BOB, signedAtMs: 1000 }]);
  const empty = await ownSignatureRows(db, (await userIdOf(db, BOB)) + 1000, FIRST_PAGE);
  expect(empty).toEqual([]);
  const none = await ownSignatureRows(db, await userIdOf(db, BOB), {
    limit: 50,
    from: { signedAt: '0001-01-01T00:00:00.000000Z', id: 1 },
  });
  expect(none).toEqual([]);
});
