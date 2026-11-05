// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { insertEvaluation } from '../adapters/db/pr-evaluation-links-fixture/test-support.ts';
import { twoTenants } from '../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import { latestEvaluationPerPr } from './current-evaluation-queries.ts';

// The latest evaluation of each pull request (E15-S01): one row per (repository, pull request number), the one touched last, so
// that a pull request that went back to an older head SHA is represented by that older row; and nothing of another tenant. The
// stories after it filter and page the result, so the tests also show that a filter on the outer query asks about the newest
// row and never about an older one.

/** Pull requests of the world are 61 and above: the fixture stores 7, 8 and 9 in the plain repository. */
async function world() {
  const { db } = await migratedTestDatabase();
  const tenants = await twoTenants(db);
  const { t1 } = tenants;
  const at = (day: number) => new Date(Date.UTC(2026, 5, day));
  const plain = { installationId: t1.installationId, repositoryId: t1.plain.repositoryId };
  const scoped = { installationId: t1.installationId, repositoryId: t1.scoped.repositoryId };
  /** The rows of the query for the repositories of tenant 1, as `<pull request>@<head digit>`, in the order of the query. */
  const latest = async (repositoryIds: readonly number[] = [t1.plain.repositoryId, t1.scoped.repositoryId]) =>
    (await latestEvaluationPerPr(db, t1.installationId, repositoryIds).execute())
      .filter((row) => row.pr_number >= 61)
      .map(
        (row) =>
          `${row.repository_id === t1.plain.repositoryId ? 'p' : 's'}${String(row.pr_number)}@${row.head_sha.slice(0, 1)}`,
      );
  const store = (
    repository: typeof plain,
    spec: { prNumber: number; head: string; day: number; result?: 'success' | 'failure' },
  ) =>
    insertEvaluation(db, repository, {
      prNumber: spec.prNumber,
      headSha: spec.head.repeat(40),
      result: spec.result ?? 'success',
      updatedAt: at(spec.day),
    });
  return { db, ...tenants, plain, scoped, latest, store };
}

test('a pull request is represented by its newest row, whatever the number of head SHAs it was evaluated at', async () => {
  const { latest, store, plain } = await world();
  await store(plain, { prNumber: 61, head: '1', day: 1 });
  await store(plain, { prNumber: 61, head: '2', day: 3 });
  await store(plain, { prNumber: 61, head: '3', day: 2 });
  expect(await latest()).toEqual(['p61@2']);
});

test('a pull request that returned to an older head SHA is represented by that older row: the upsert made it the newest by updated_at, though a newer head has the higher id', async () => {
  const { db, latest, store, plain } = await world();
  const older = await store(plain, { prNumber: 61, head: '1', day: 1 });
  const newer = await store(plain, { prNumber: 61, head: '2', day: 2 });
  expect(newer).toBeGreaterThan(older);
  expect(await latest()).toEqual(['p61@2']);
  await db
    .updateTable('pr_evaluations')
    .set({ updated_at: new Date(Date.UTC(2026, 5, 9)) })
    .where('id', '=', older)
    .execute();
  expect(await latest()).toEqual(['p61@1']);
});

test('two rows touched at the same instant are told apart by the id, the higher one being the latest', async () => {
  const { latest, store, plain } = await world();
  await store(plain, { prNumber: 61, head: '1', day: 4 });
  await store(plain, { prNumber: 61, head: '2', day: 4 });
  await store(plain, { prNumber: 61, head: '3', day: 4 });
  expect(await latest()).toEqual(['p61@3']);
});

test('the same pull request number in two repositories of the tenant is two pull requests, each with its own latest row, and the rows come in the order of repository and number', async () => {
  const { latest, store, plain, scoped } = await world();
  expect(plain.repositoryId).toBeLessThan(scoped.repositoryId);
  await store(scoped, { prNumber: 61, head: '1', day: 5 });
  await store(plain, { prNumber: 62, head: '2', day: 1 });
  await store(plain, { prNumber: 61, head: '3', day: 2 });
  expect(await latest()).toEqual(['p61@3', 'p62@2', 's61@1']);
});

test('only the repositories asked for are read, and none asked for is no row', async () => {
  const { latest, store, plain, scoped } = await world();
  await store(plain, { prNumber: 61, head: '1', day: 1 });
  await store(scoped, { prNumber: 62, head: '2', day: 1 });
  expect(await latest([plain.repositoryId])).toEqual(['p61@1']);
  expect(await latest([scoped.repositoryId])).toEqual(['s62@2']);
  expect(await latest([])).toEqual([]);
});

test('the rows of another tenant are never read, whichever repository ids are given: its ids under this tenant answer nothing, and a mix answers only the own rows', async () => {
  const { db, t1, t2, latest, store, plain } = await world();
  await store(plain, { prNumber: 61, head: '1', day: 1 });
  await store(
    { installationId: t2.installationId, repositoryId: t2.plain.repositoryId },
    { prNumber: 61, head: '1', day: 9 },
  );
  expect(await latest([t2.plain.repositoryId, t2.scoped.repositoryId])).toEqual([]);
  expect(await latest([t2.plain.repositoryId, t1.plain.repositoryId])).toEqual(['p61@1']);
  const ofTenant2 = await latestEvaluationPerPr(db, t2.installationId, [t1.plain.repositoryId]).execute();
  expect(ofTenant2).toEqual([]);
});

test('a filter on the outer query asks about the newest row only: a pull request whose newest row passes is not a failing one, though an older head SHA failed', async () => {
  const { db, t1, store, plain } = await world();
  await store(plain, { prNumber: 61, head: '1', day: 1, result: 'failure' });
  await store(plain, { prNumber: 61, head: '2', day: 2, result: 'success' });
  await store(plain, { prNumber: 62, head: '3', day: 1, result: 'success' });
  await store(plain, { prNumber: 62, head: '4', day: 2, result: 'failure' });
  const failing = await db
    .selectFrom(latestEvaluationPerPr(db, t1.installationId, [t1.plain.repositoryId]).as('latest'))
    .select(['latest.pr_number', 'latest.head_sha'])
    .where('latest.result', '=', 'failure')
    .where('latest.pr_number', '>=', 61)
    .execute();
  expect(failing).toEqual([{ pr_number: 62, head_sha: '4'.repeat(40) }]);
});

test('the state is a column of the row and not a filter: a closed pull request is returned with its state, for the outer query to decide', async () => {
  const { db, t1, store, plain } = await world();
  const closed = await store(plain, { prNumber: 61, head: '1', day: 1 });
  await store(plain, { prNumber: 62, head: '2', day: 1 });
  await db.updateTable('pr_evaluations').set({ pr_state: 'closed' }).where('id', '=', closed).execute();
  const rows = await latestEvaluationPerPr(db, t1.installationId, [t1.plain.repositoryId]).execute();
  expect(rows.filter((row) => row.pr_number >= 61).map((row) => [row.pr_number, row.pr_state])).toEqual([
    [61, 'closed'],
    [62, 'open'],
  ]);
});
