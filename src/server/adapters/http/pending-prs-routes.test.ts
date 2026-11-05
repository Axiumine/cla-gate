// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { shaOf } from '../../domain/pending-details-fixture/test-support.ts';
import { plainOf, scopedOf } from './commit-override-fixture/test-support.ts';
import {
  checksumsWithoutLedger,
  errorCodeOf,
  namesOf,
  pageOf,
  pendingWorld,
  storeEvaluations,
  withoutRequestId,
} from './pending-prs-fixture/test-support.ts';

// `GET /api/installations/:installationId/pending-prs` (E15-S07): who may read it, what an item holds, and that it reads only. The
// boundaries of the rows are in pending-prs-boundaries.test.ts, the filters in pending-prs-filters.test.ts, the reasons in
// pending-prs-reasons.test.ts, the pages in pending-prs-pages.test.ts, the query string in pending-prs-query.test.ts and the tenants
// in pending-prs-tenants.test.ts.

test('an org admin sees the open pull requests whose latest evaluation failed, in every enabled repository, the most recently written first', async () => {
  const world = await pendingWorld();
  const { pending, t1 } = world;
  const [older] = await storeEvaluations(world, plainOf(t1), [{ prNumber: 5, updatedAt: '2026-10-01T10:00:00Z' }]);
  const [newer] = await storeEvaluations(world, scopedOf(t1), [{ prNumber: 3, updatedAt: '2026-10-02T10:00:00Z' }]);
  const response = await pending('admin1', t1.installationId);
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(namesOf(response)).toEqual(['org-1/scoped#3', 'org-1/repo#5']);
  expect(pageOf(response).items.map((item) => item.evaluationId)).toEqual([newer, older]);
  expect(pageOf(response)).toMatchObject({ nextCursor: null, truncated: false });
});

test('an item holds the evaluation, the repository, the pull request, the head SHA, the time, the Check Run and the reasons', async () => {
  const world = await pendingWorld();
  const { pending, t1 } = world;
  const [id] = await storeEvaluations(world, plainOf(t1), [
    {
      prNumber: 12,
      head: 0xabc,
      updatedAt: '2026-10-02T10:20:30.456Z',
      checkRunId: 99_000_000_001,
      details: { codes: ['unsigned_contributor'], actors: [{ githubId: 31_001 }, { githubId: 777, covered: true }] },
    },
  ]);
  expect(pageOf(await pending('admin1', t1.installationId)).items).toEqual([
    {
      evaluationId: id,
      repository: { id: t1.plain.repositoryId, fullName: 'org-1/repo' },
      prNumber: 12,
      headSha: shaOf(0xabc),
      evaluatedAt: '2026-10-02T10:20:30.456Z',
      checkRunId: 99_000_000_001,
      reasons: [{ code: 'unsigned_contributor', githubId: 31_001, login: 'login-31001' }],
    },
  ]);
});

test('a pull request that has no Check Run yet is listed with checkRunId null', async () => {
  const world = await pendingWorld();
  await storeEvaluations(world, plainOf(world.t1), [{ prNumber: 4 }]);
  expect(pageOf(await world.pending('admin1', world.t1.installationId)).items.map((item) => item.checkRunId)).toEqual([
    null,
  ]);
});

test('a viewer who is only a repository admin sees the pull requests of the repository whose own CLA document is enforced, and nothing of the others', async () => {
  const world = await pendingWorld();
  const { pending, t1 } = world;
  await storeEvaluations(world, plainOf(t1), [{ prNumber: 5 }]);
  await storeEvaluations(world, scopedOf(t1), [{ prNumber: 6 }]);
  expect(namesOf(await pending('repoAdmin1', t1.installationId))).toEqual(['org-1/scoped#6']);
  expect(namesOf(await pending('repoAdmin1', t1.installationId, `?repositoryId=${t1.scoped.repositoryId}`))).toEqual([
    'org-1/scoped#6',
  ]);
  expect(namesOf(await pending('repoAdmin1', t1.installationId, `?repositoryId=${t1.plain.repositoryId}`))).toEqual([]);
});

test("a repository whose enforced document is the organisation's is not shown to its repository admin, even when it has a document of its own", async () => {
  const world = await pendingWorld();
  const { db, pending, t1 } = world;
  await storeEvaluations(world, scopedOf(t1), [{ prNumber: 6 }]);
  await db
    .updateTable('repositories')
    .set({ cla_document_id: t1.documentId })
    .where('id', '=', t1.scoped.repositoryId)
    .execute();
  expect(namesOf(await pending('repoAdmin1', t1.installationId))).toEqual([]);
  expect(namesOf(await pending('admin1', t1.installationId))).toEqual(['org-1/scoped#6']);
});

test('a repository admin whose role GitHub no longer confirms sees nothing of that repository', async () => {
  const world = await pendingWorld();
  const { pending, roles, roleTable, t1 } = world;
  await storeEvaluations(world, scopedOf(t1), [{ prNumber: 6 }]);
  roles.load({ ...roleTable, repositories: roleTable.repositories.filter((row) => row.login !== 'login-31003') });
  expect((await pending('repoAdmin1', t1.installationId)).statusCode).toBe(404);
  expect(namesOf(await pending('admin1', t1.installationId))).toEqual(['org-1/scoped#6']);
});

test('a viewer with no role in the tenant, a person of another tenant and a call with no session are refused alike: 404, 404 and 401', async () => {
  const world = await pendingWorld();
  const { pending, t1 } = world;
  await storeEvaluations(world, plainOf(t1), [{ prNumber: 5 }]);
  const unknown = await pending('admin1', 987_654);
  expect(unknown.statusCode).toBe(404);
  for (const who of ['member1', 'outsider', 'admin2'] as const) {
    const response = await pending(who, t1.installationId);
    expect([who, response.statusCode, errorCodeOf(response)]).toEqual([who, 404, 'not_found']);
    expect(withoutRequestId(response)).toBe(withoutRequestId(unknown));
  }
  expect((await pending(null, t1.installationId)).statusCode).toBe(401);
});

test('the list of a suspended installation, and of one whose App was uninstalled, is empty, and the pull requests come back with the installation', async () => {
  const world = await pendingWorld();
  const { db, pending, t1 } = world;
  await storeEvaluations(world, plainOf(t1), [{ prNumber: 5 }]);
  const set = (values: { suspended_at?: Date | null; deleted_at?: Date | null }) =>
    db.updateTable('installations').set(values).where('id', '=', t1.installationId).execute();
  // A call of the admin while the installation is live puts them in the ledger of E11-S07, which serves the reads that follow.
  expect(namesOf(await pending('admin1', t1.installationId))).toEqual(['org-1/repo#5']);
  await set({ suspended_at: new Date('2026-10-01T00:00:00Z') });
  expect(pageOf(await pending('admin1', t1.installationId)).items).toEqual([]);
  await set({ suspended_at: null, deleted_at: new Date('2026-10-01T00:00:00Z') });
  expect(pageOf(await pending('admin1', t1.installationId)).items).toEqual([]);
  await set({ deleted_at: null });
  expect(namesOf(await pending('admin1', t1.installationId))).toEqual(['org-1/repo#5']);
});

test('an installation the admission policy rejected is the 404 of an id that exists nowhere', async () => {
  const world = await pendingWorld();
  const { db, pending, t1 } = world;
  await db
    .updateTable('installations')
    .set({ admission_status: 'rejected', admission_reason: 'account_not_allowed' })
    .where('id', '=', t1.installationId)
    .execute();
  expect((await pending('admin1', t1.installationId)).statusCode).toBe(404);
});

test('the list reads only: it asks GitHub nothing, writes no row of any tenant table and appends no audit row', async () => {
  const world = await pendingWorld();
  const { db, fakeGitHub, pending, t1 } = world;
  await storeEvaluations(world, plainOf(t1), [{ prNumber: 5 }, { prNumber: 6 }]);
  const before = await checksumsWithoutLedger(db);
  const audit = () => db.selectFrom('audit_log').select('id').execute();
  const auditBefore = await audit();
  expect((await pending('admin1', t1.installationId)).statusCode).toBe(200);
  expect((await pending('repoAdmin1', t1.installationId)).statusCode).toBe(200);
  expect(fakeGitHub.calls).toEqual([]);
  expect(await checksumsWithoutLedger(db)).toEqual(before);
  expect(await audit()).toEqual(auditBefore);
});

test('a page of an org admin asks the role lookup nothing beyond the guard: the same calls for an empty list and for a full one', async () => {
  const empty = await pendingWorld();
  await empty.pending('admin1', empty.t1.installationId);
  const full = await pendingWorld();
  await storeEvaluations(full, plainOf(full.t1), [{ prNumber: 5 }, { prNumber: 6 }, { prNumber: 7 }]);
  await full.pending('admin1', full.t1.installationId);
  expect(full.roles.calls).toEqual(empty.roles.calls);
});
