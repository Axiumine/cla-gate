// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { insertEvaluation } from '../../adapters/db/pr-evaluation-links-fixture/test-support.ts';
import { twoTenants } from '../../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase } from '../../adapters/db/test-support.ts';
import { failEvaluation, setPullRequestState, startEvaluation } from './evaluation-rows.ts';

// The writes of `pr_state` (E15-S01): the upsert of the evaluation job sets it from the pull request it fetched, on insert and on
// conflict; `setPullRequestState` sets it on every row of one pull request of one repository of one tenant and changes nothing
// else; and the dead-letter write keeps the state a row has. Pull requests of these tests are 61 and above (the fixture stores 7, 8 and 9).

async function world() {
  const { db } = await migratedTestDatabase();
  const tenants = await twoTenants(db);
  const { t1, t2 } = tenants;
  const at = new Date(Date.UTC(2026, 5, 1));
  const plain = { installationId: t1.installationId, repositoryId: t1.plain.repositoryId };
  const scoped = { installationId: t1.installationId, repositoryId: t1.scoped.repositoryId };
  const neighbour = { installationId: t2.installationId, repositoryId: t2.plain.repositoryId };
  const key = (prNumber: number, digit: string, repository = plain) => ({
    ...repository,
    prNumber,
    headSha: digit.repeat(40),
  });
  const store = (repository: typeof plain, prNumber: number, digit: string) =>
    insertEvaluation(db, repository, { prNumber, headSha: digit.repeat(40), result: 'success', updatedAt: at });
  /** The states of the rows of the pull requests 61 and above, as `<installation>/<repository>#<number>@<head digit>: <state>`, oldest row first. */
  const states = async () =>
    (
      await db
        .selectFrom('pr_evaluations')
        .select(['installation_id', 'repository_id', 'pr_number', 'head_sha', 'pr_state'])
        .where('pr_number', '>=', 61)
        .orderBy('id')
        .execute()
    ).map(
      (row) =>
        `${row.installation_id === t1.installationId ? 't1' : 't2'}/${row.repository_id === t1.plain.repositoryId || row.repository_id === t2.plain.repositoryId ? 'plain' : 'scoped'}#${String(row.pr_number)}@${row.head_sha.slice(0, 1)}: ${row.pr_state}`,
    );
  return { db, ...tenants, at, plain, scoped, neighbour, key, store, states };
}

test.each([
  ['open', 'open'],
  ['closed', 'closed'],
] as const)('the upsert stores a new row with the state the job fetched: %s', async (prState, expected) => {
  const { db, key, states } = await world();
  await startEvaluation(db, key(61, '1'), prState);
  expect(await states()).toEqual([`t1/plain#61@1: ${expected}`]);
});

test.each([
  ['open', 'closed'],
  ['closed', 'open'],
] as const)(
  'the upsert of a row that exists sets the state the job fetched (%s over %s), and keeps the id and the Check Run of the row',
  async (prState, before) => {
    const { db, key, states } = await world();
    const id = await startEvaluation(db, key(61, '1'), before);
    await db.updateTable('pr_evaluations').set({ check_run_id: 4711 }).where('id', '=', id).execute();
    expect(await startEvaluation(db, key(61, '1'), prState)).toBe(id);
    expect(await states()).toEqual([`t1/plain#61@1: ${prState}`]);
    const row = await db
      .selectFrom('pr_evaluations')
      .select('check_run_id')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.check_run_id).toBe(4711);
  },
);

test('setPullRequestState changes every row of the pull request, each head SHA, and no row of another pull request, another repository or another tenant', async () => {
  const { db, plain, scoped, neighbour, key, store, states } = await world();
  for (const [repository, prNumber, digit] of [
    [plain, 61, '1'],
    [plain, 61, '2'],
    [plain, 62, '3'],
    [scoped, 61, '4'],
    [neighbour, 61, '5'],
  ] as const) {
    await store(repository, prNumber, digit);
  }
  expect(await setPullRequestState(db, key(61, '1'), 'closed')).toBe(2);
  expect(await states()).toEqual([
    't1/plain#61@1: closed',
    't1/plain#61@2: closed',
    't1/plain#62@3: open',
    't1/scoped#61@4: open',
    't2/plain#61@5: open',
  ]);
  expect(await setPullRequestState(db, key(61, '1'), 'open')).toBe(2);
  expect(await states()).toEqual([
    't1/plain#61@1: open',
    't1/plain#61@2: open',
    't1/plain#62@3: open',
    't1/scoped#61@4: open',
    't2/plain#61@5: open',
  ]);
});

test('setPullRequestState changes only the rows that do not hold the state yet: a second call changes nothing and says so, and a pull request with no row is no change', async () => {
  const { db, plain, key, store } = await world();
  await store(plain, 61, '1');
  expect(await setPullRequestState(db, key(61, '1'), 'open')).toBe(0);
  expect(await setPullRequestState(db, key(61, '1'), 'closed')).toBe(1);
  expect(await setPullRequestState(db, key(61, '1'), 'closed')).toBe(0);
  expect(await setPullRequestState(db, key(99, '1'), 'closed')).toBe(0);
});

test('setPullRequestState leaves updated_at, the result, the details and the reporter columns as they are', async () => {
  const { db, plain, at, key, store } = await world();
  const id = await store(plain, 61, '1');
  await db.updateTable('pr_evaluations').set({ check_run_id: 4711, comment_id: 4712 }).where('id', '=', id).execute();
  const read = () => db.selectFrom('pr_evaluations').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const before = await read();
  await setPullRequestState(db, key(61, '1'), 'closed');
  expect(await read()).toEqual({ ...before, pr_state: 'closed' });
  expect((await read()).updated_at).toEqual(at);
});

test('the dead-letter write creates a row open and keeps the state of a row that exists, a closed one included', async () => {
  const { db, key, states } = await world();
  expect(await failEvaluation(db, key(61, '1'), 'keep')).not.toBeNull();
  expect(await states()).toEqual(['t1/plain#61@1: open']);
  await setPullRequestState(db, key(61, '1'), 'closed');
  expect(await failEvaluation(db, key(61, '1'), 'replace')).not.toBeNull();
  expect(await states()).toEqual(['t1/plain#61@1: closed']);
});
