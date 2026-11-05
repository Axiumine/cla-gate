// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { plainOf, scopedOf } from './commit-override-fixture/test-support.ts';
import { type PendingWorld, pageOf, pendingWorld, storeEvaluations } from './pending-prs-fixture/test-support.ts';

// The paging of GET /api/installations/:installationId/pending-prs (E15-S07): `limit` 1 to 100 (50 by default), the row written last first
// with the id as the tie-break, and an opaque keyset cursor. The query string is in pending-prs-query.test.ts.

/** The first number of the pull requests these tests store: the world stores the numbers 7 to 10 itself. */
const FIRST = 100;

/** Reads every page of the list of tenant 1 with `limit`, following the cursors, and answers the pages. */
async function allPages(world: PendingWorld, limit: number, query = '') {
  const pages: ReturnType<typeof pageOf>[] = [];
  let cursor: string | null = null;
  do {
    const paging: string = cursor === null ? `?limit=${limit}` : `?limit=${limit}&cursor=${cursor}`;
    const response = await world.pending('admin1', world.t1.installationId, `${paging}${query}`);
    const page = pageOf(response);
    pages.push(page);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return pages;
}

/** 120 failed pull requests, half in each repository of tenant 1, that all share the instant they were written at. */
async function storeTied(world: PendingWorld): Promise<void> {
  const rows = (offset: number) =>
    Array.from({ length: 60 }, (_unused, index) => ({
      prNumber: FIRST + offset + index,
      updatedAt: '2026-10-01T10:00:00Z',
    }));
  await storeEvaluations(world, plainOf(world.t1), rows(0));
  await storeEvaluations(world, scopedOf(world.t1), rows(60));
}

test('120 pull requests with equal updated_at are read in pages of 50 without a duplicate or a gap, the id breaking every tie', async () => {
  const world = await pendingWorld();
  await storeTied(world);
  const expected = await world.db
    .selectFrom('pr_evaluations')
    .select('id')
    .where('installation_id', '=', world.t1.installationId)
    .where('pr_number', '>=', FIRST)
    .orderBy('id', 'desc')
    .execute();
  const pages = await allPages(world, 50);
  expect(pages.map((page) => page.items.length)).toEqual([50, 50, 20]);
  expect(pages.map((page) => page.nextCursor === null)).toEqual([false, false, true]);
  const ids = pages.flatMap((page) => page.items.map((item) => item.evaluationId));
  expect(ids).toEqual(expected.map((row) => row.id));
  expect(new Set(ids).size).toBe(120);
});

test('the same 120 are read in pages of every size from 1 to 100 with the same result', async () => {
  const world = await pendingWorld();
  await storeTied(world);
  const whole = (await allPages(world, 100)).flatMap((page) => page.items.map((item) => item.evaluationId));
  expect(whole).toHaveLength(120);
  for (const limit of [1, 7, 33, 60, 99]) {
    const ids = (await allPages(world, limit)).flatMap((page) => page.items.map((item) => item.evaluationId));
    expect([limit, ids]).toEqual([limit, whole]);
  }
});

test('pull requests written within one millisecond are told apart by the microseconds of the cursor, one page after the other, with none skipped', async () => {
  const world = await pendingWorld();
  await storeEvaluations(world, plainOf(world.t1), [
    { prNumber: FIRST + 1, updatedAt: '2026-10-01T10:00:00.123403Z' },
    { prNumber: FIRST + 2, updatedAt: '2026-10-01T10:00:00.123401Z' },
    { prNumber: FIRST + 3, updatedAt: '2026-10-01T10:00:00.123402Z' },
  ]);
  const pages = await allPages(world, 1);
  expect(pages.flatMap((page) => page.items.map((item) => item.prNumber - FIRST))).toEqual([1, 3, 2]);
  expect(pages.map((page) => page.items.length)).toEqual([1, 1, 1]);
});

test('a list that holds exactly the limit is one page with no cursor, and one more pull request makes a second page with that one only', async () => {
  const world = await pendingWorld();
  await storeEvaluations(world, plainOf(world.t1), [
    { prNumber: FIRST + 1, updatedAt: '2026-10-03T10:00:00Z' },
    { prNumber: FIRST + 2, updatedAt: '2026-10-02T10:00:00Z' },
    { prNumber: FIRST + 3, updatedAt: '2026-10-01T10:00:00Z' },
  ]);
  expect((await allPages(world, 3)).map((page) => [page.items.length, page.nextCursor])).toEqual([[3, null]]);
  await storeEvaluations(world, plainOf(world.t1), [{ prNumber: FIRST + 4, updatedAt: '2026-09-01T00:00:00Z' }]);
  expect((await allPages(world, 3)).map((page) => page.items.length)).toEqual([3, 1]);
});

test('a pull request written between two pages neither repeats one already read nor hides one still to come', async () => {
  const world = await pendingWorld();
  await storeEvaluations(world, plainOf(world.t1), [
    { prNumber: FIRST + 1, updatedAt: '2026-10-04T10:00:00Z' },
    { prNumber: FIRST + 2, updatedAt: '2026-10-03T10:00:00Z' },
    { prNumber: FIRST + 3, updatedAt: '2026-10-02T10:00:00Z' },
  ]);
  const first = pageOf(await world.pending('admin1', world.t1.installationId, '?limit=2'));
  await storeEvaluations(world, plainOf(world.t1), [{ prNumber: FIRST + 9, updatedAt: '2026-10-05T10:00:00Z' }]);
  const second = pageOf(await world.pending('admin1', world.t1.installationId, `?limit=2&cursor=${first.nextCursor}`));
  expect(first.items.map((item) => item.prNumber - FIRST)).toEqual([1, 2]);
  expect(second.items.map((item) => item.prNumber - FIRST)).toEqual([3]);
});

test('the page holds 50 pull requests when the request names no limit, and 100 at most', async () => {
  const world = await pendingWorld();
  await storeTied(world);
  const sizes: number[] = [];
  for (const query of ['', '?limit=100', '?limit=1']) {
    sizes.push(pageOf(await world.pending('admin1', world.t1.installationId, query)).items.length);
  }
  expect(sizes).toEqual([50, 100, 1]);
});

test('the pages of a filter by reason hold only the matches and end where the matches end', async () => {
  const world = await pendingWorld();
  await storeEvaluations(world, plainOf(world.t1), [
    ...Array.from({ length: 5 }, (_unused, index) => ({
      prNumber: FIRST + index,
      details: { codes: ['no_active_cla' as const] },
      updatedAt: `2026-10-01T10:00:0${String(index)}Z`,
    })),
    ...Array.from({ length: 5 }, (_unused, index) => ({
      prNumber: FIRST + 10 + index,
      updatedAt: `2026-10-01T10:00:0${String(index)}Z`,
    })),
  ]);
  const pages = await allPages(world, 2, '&reason=no_active_cla');
  expect(pages.map((page) => page.items.length)).toEqual([2, 2, 1]);
  const numbers = pages.flatMap((page) => page.items.map((item) => item.prNumber));
  expect(numbers.every((number) => number < FIRST + 10)).toBe(true);
  expect(new Set(numbers).size).toBe(5);
});
