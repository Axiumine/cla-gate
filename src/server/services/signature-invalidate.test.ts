// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { tenantChecksums } from '../adapters/db/tenant-fixture/test-support.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import {
  addSignatures,
  invalidationAuditRows,
  invalidationBy,
  majorOneOf,
  publishMajor,
  signatureStates,
} from './invalidation-fixture/test-support.ts';
import { failingAfterSend, fakeEnqueuer, sentJobs, setJobStates } from './jobs-fixture/test-support.ts';
import { revocationWorld, sentAs } from './revocation-fixture/test-support.ts';
import { invalidateMajor } from './signature-invalidate.ts';
import { previewInvalidation } from './signature-invalidate-preview.ts';

// The service of the invalidation of a major (E15-S04), on the two tenants of the revocation world: what one call writes, what it refuses
// and that it commits with its audit row and its sweeps or not at all. Tenant 1's installation-wide document has one signature at major 1,
// the signer's (`t1.signatureId`); both of its repositories are on and enforce the document. `addSignatures` makes more.

/** The world, with two more signatures of tenant 1 at major 1 (so three are in force) and the scope of tenant 1. */
async function world() {
  const base = await revocationWorld();
  const { db, t1, t2 } = base;
  const added = await addSignatures(db, majorOneOf(t1), 2, 50_000);
  const scope = { installationId: t1.installationId };
  const deps = { db, enqueuer: base.queue };
  return { ...base, added, scope, deps, majorOne: majorOneOf(t1), otherTenant: majorOneOf(t2) };
}

test('an invalidation revokes every signature of the major in force with one instant, one person and one reason, and answers with the count', async () => {
  const { deps, db, t1, people, scope, added, majorOne } = await world();
  const count = await invalidateMajor(deps, scope, invalidationBy(t1, majorOne, 3));
  const states = await signatureStates(db, t1.documentId);
  expect(count).toBe(3);
  expect(states.map((row) => row.id)).toEqual([t1.signatureId, ...added]);
  expect(new Set(states.map((row) => row.revoked_at?.getTime())).size).toBe(1);
  expect(states.every((row) => row.revoked_at instanceof Date)).toBe(true);
  expect(states.map((row) => [row.revoked_by, row.revoke_reason])).toEqual(
    states.map(() => [people.admin1.userId, 'maintainer_decision']),
  );
});

test("it leaves alone what it was not asked for: another major of the document, an earlier revocation with its own record, and the other tenant's signatures", async () => {
  const { deps, db, t1, t2, people, scope, majorOne, added } = await world();
  const second = await publishMajor(db, t1, 2);
  const [atSecond] = await addSignatures(db, second, 1, 60_000);
  await db
    .updateTable('signatures')
    .set({ revoked_at: sql<Date>`now()`, revoked_by: people.admin2.userId, revoke_reason: 'legal_request' })
    .where('id', '=', added[0] ?? 0)
    .execute();
  const earlier = (await signatureStates(db, t1.documentId)).find((row) => row.id === added[0]);
  const others = await signatureStates(db, t2.documentId);
  const count = await invalidateMajor(deps, scope, invalidationBy(t1, majorOne, 2));
  const states = new Map((await signatureStates(db, t1.documentId)).map((row) => [row.id, row]));
  expect(count).toBe(2);
  expect(states.get(atSecond ?? 0)).toMatchObject({
    major: 2,
    revoked_at: null,
    revoked_by: null,
    revoke_reason: null,
  });
  expect(earlier).toMatchObject({ revoked_by: people.admin2.userId, revoke_reason: 'legal_request' });
  expect(states.get(added[0] ?? 0)).toEqual(earlier);
  expect(states.get(added[1] ?? 0)?.revoke_reason).toBe('maintainer_decision');
  expect(await signatureStates(db, t2.documentId)).toEqual(others);
});

test('one audit row records the whole action: the document as the subject, the major, the count and the reason code, and no name', async () => {
  const { deps, db, t1, people, scope, majorOne } = await world();
  await invalidateMajor(deps, scope, { ...invalidationBy(t1, majorOne, 3), reason: 'legal_request' });
  const [audit, ...more] = await invalidationAuditRows(db);
  expect(more).toEqual([]);
  expect(audit).toMatchObject({
    installation_id: t1.installationId,
    actor_github_id: people.admin1.githubId,
    action: 'signatures.invalidated',
    subject_type: 'document',
    subject_id: t1.documentId,
    metadata: { major: 1, count: 3, reason_code: 'legal_request' },
  });
  expect(Object.keys(audit?.metadata ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
    'count',
    'major',
    'reason_code',
  ]);
  const revokedRows = await db.selectFrom('audit_log').select('id').where('action', '=', 'signature.revoked').execute();
  expect(revokedRows).toEqual([]);
});

test.each([
  ['fewer than are in force', 2],
  ['more than are in force', 4],
])(
  'a confirmed count that is %s is count_changed: the transaction rolls back, nothing is revoked, no audit row and no job is written',
  async (_label, expected) => {
    const { deps, db, t1, scope, majorOne } = await world();
    const before = await tenantChecksums(db);
    await expect(invalidateMajor(deps, scope, invalidationBy(t1, majorOne, expected))).rejects.toEqual(
      new ClaRuleError('count_changed'),
    );
    expect(await tenantChecksums(db)).toEqual(before);
    expect((await signatureStates(db, t1.documentId)).map((row) => row.revoked_at)).toEqual([null, null, null]);
    expect(await invalidationAuditRows(db)).toEqual([]);
    expect(await sentJobs(db)).toEqual([]);
  },
);

test('a major with no signature in force is nothing_to_invalidate, whatever count was confirmed, and one that was invalidated is nothing left to invalidate', async () => {
  const { deps, db, t1, scope, majorOne } = await world();
  const before = await tenantChecksums(db);
  await expect(invalidateMajor(deps, scope, invalidationBy(t1, { ...majorOne, major: 2 }, 3))).rejects.toEqual(
    new ClaRuleError('nothing_to_invalidate'),
  );
  expect(await tenantChecksums(db)).toEqual(before);
  await invalidateMajor(deps, scope, invalidationBy(t1, majorOne, 3));
  const sent = await sentJobs(db);
  await expect(invalidateMajor(deps, scope, invalidationBy(t1, majorOne, 3))).rejects.toEqual(
    new ClaRuleError('nothing_to_invalidate'),
  );
  expect(await invalidationAuditRows(db)).toHaveLength(1);
  expect(await sentJobs(db)).toEqual(sent);
});

test("a document that is not the tenant's is not found, though it exists: the tenant of the scope is the only one looked in, and nothing is written", async () => {
  const { deps, db, t1, t2, scope, otherTenant } = await world();
  const before = await tenantChecksums(db);
  for (const documentId of [t2.documentId, 987_654]) {
    await expect(invalidateMajor(deps, scope, invalidationBy(t1, { ...otherTenant, documentId }, 1))).rejects.toEqual(
      new ClaRuleError('not_found'),
    );
  }
  expect(await tenantChecksums(db)).toEqual(before);
});

test('a sweep-repository job with the reason signatures_invalidated is sent to each repository that enforces the document, keyed by the document, the major, the instant and the repository', async () => {
  const { deps, db, t1, scope, majorOne } = await world();
  await invalidateMajor(deps, scope, invalidationBy(t1, majorOne, 3));
  const [signed] = await signatureStates(db, t1.documentId);
  const at = signed?.revoked_at?.getTime();
  const sent = await sentJobs(db);
  expect(sent.map(({ job }) => job)).toEqual(
    [t1.plain, t1.scoped].map((repository) => ({
      type: 'sweep-repository',
      githubInstallationId: t1.githubInstallationId,
      githubRepoId: repository.githubRepoId,
      reason: 'signatures_invalidated',
    })),
  );
  expect(sent.map((job) => job.idempotencyKey)).toEqual(
    [t1.plain, t1.scoped].map(
      (repository) => `sweep-repository:signatures_invalidated:${t1.documentId}:1:${at}:${repository.githubRepoId}`,
    ),
  );
  expect(sent.map((job) => job.coalesceKey)).toEqual(
    [t1.plain, t1.scoped].map((repository) => `sweep-repository:${repository.githubRepoId}`),
  );
});

test.each([
  [
    'is disabled',
    (db: Awaited<ReturnType<typeof world>>['db'], id: number) =>
      db.updateTable('repositories').set({ enabled: false }).where('id', '=', id).execute(),
  ],
  [
    'is no longer listed by GitHub',
    (db: Awaited<ReturnType<typeof world>>['db'], id: number) =>
      db
        .updateTable('repositories')
        .set({ removed_at: new Date('2026-10-01T00:00:00Z') })
        .where('id', '=', id)
        .execute(),
  ],
  [
    'enforces another document',
    (db: Awaited<ReturnType<typeof world>>['db'], id: number) =>
      db
        .updateTable('repositories')
        .set({ cla_document_id: sql<number>`(select id from cla_documents where repository_id = ${id})` })
        .where('id', '=', id)
        .execute(),
  ],
])('a repository that %s is not swept: only the other one is', async (_label, change) => {
  const { deps, db, t1, scope, majorOne } = await world();
  await change(db, t1.scoped.repositoryId);
  await invalidateMajor(deps, scope, invalidationBy(t1, majorOne, 3));
  expect(await sentAs(db)).toEqual([`sweep ${t1.plain.githubRepoId}`]);
});

test("the other tenant's repositories are never swept by an invalidation of this tenant's document, and a document that no repository enforces sends nothing", async () => {
  const { deps, db, t1, scope, majorOne } = await world();
  await db
    .updateTable('repositories')
    .set({ enabled: false })
    .where('installation_id', '=', t1.installationId)
    .execute();
  await invalidateMajor(deps, scope, invalidationBy(t1, majorOne, 3));
  expect(await sentJobs(db)).toEqual([]);
  expect(await invalidationAuditRows(db)).toHaveLength(1);
});

test('a second invalidation of the same major, after people signed again, sends sweeps under keys of its own, and its audit row is a second one', async () => {
  const { deps, db, t1, scope, majorOne } = await world();
  await invalidateMajor(deps, scope, invalidationBy(t1, majorOne, 3));
  const first = (await sentJobs(db)).map((job) => job.idempotencyKey);
  await setJobStates(db, 'completed');
  await addSignatures(db, majorOne, 1, 70_000);
  await invalidateMajor(deps, scope, invalidationBy(t1, majorOne, 1));
  const all = (await sentJobs(db)).map((job) => job.idempotencyKey);
  expect(all).toHaveLength(4);
  expect(new Set(all).size).toBe(4);
  expect(all.slice(0, 2)).toEqual(first);
  expect((await invalidationAuditRows(db)).map((row) => row.metadata)).toEqual([
    { major: 1, count: 3, reason_code: 'maintainer_decision' },
    { major: 1, count: 1, reason_code: 'maintainer_decision' },
  ]);
});

test("a queue that fails rolls everything back, the sweep it did send included: the signatures are in force, there is no audit row, and the error is the queue's", async () => {
  const { db, t1, scope, majorOne } = await world();
  const down = new Error('zzzz the queue is down');
  const before = await tenantChecksums(db);
  await expect(
    invalidateMajor({ db, enqueuer: failingAfterSend(fakeEnqueuer(), down) }, scope, invalidationBy(t1, majorOne, 3)),
  ).rejects.toBe(down);
  expect(await tenantChecksums(db)).toEqual(before);
  expect(await sentJobs(db)).toEqual([]);
  expect(await invalidationAuditRows(db)).toEqual([]);
});

test('the preview counts the signatures of the major in force and the repositories that enforce the document, and nothing else', async () => {
  const { db, t1, scope, added, majorOne } = await world();
  await db
    .updateTable('signatures')
    .set({ revoked_at: sql<Date>`now()`, revoked_by: t1.publisherId, revoke_reason: 'other' })
    .where('id', '=', added[0] ?? 0)
    .execute();
  await db.updateTable('repositories').set({ enabled: false }).where('id', '=', t1.scoped.repositoryId).execute();
  const second = await publishMajor(db, t1, 2);
  await addSignatures(db, second, 4, 80_000);
  expect(await previewInvalidation(db, scope, majorOne)).toEqual({ activeSignatures: 2, affectedRepositories: 1 });
  expect(await previewInvalidation(db, scope, { ...majorOne, major: 2 })).toEqual({
    activeSignatures: 4,
    affectedRepositories: 1,
  });
  expect(await previewInvalidation(db, scope, { ...majorOne, major: 3 })).toEqual({
    activeSignatures: 0,
    affectedRepositories: 1,
  });
});

test("the preview of a document that is not the tenant's is not found, and it writes nothing", async () => {
  const { db, t2, scope, otherTenant } = await world();
  const before = await tenantChecksums(db);
  for (const documentId of [t2.documentId, 987_654]) {
    await expect(previewInvalidation(db, scope, { ...otherTenant, documentId })).rejects.toEqual(
      new ClaRuleError('not_found'),
    );
  }
  expect(await tenantChecksums(db)).toEqual(before);
});
