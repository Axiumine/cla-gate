// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  listOverridesAs,
  overrideWorld,
  pageOf,
  type SeededOverride,
  scopedOf,
  seedOverrides,
  shaOf,
} from './commit-override-fixture/test-support.ts';
import { errorCodeOf } from './document-fixture/test-support.ts';

// The paging of GET /api/repositories/:repositoryId/commit-overrides (E15-S06): `limit` 1 to 100 (50 by default), newest first with the
// id as the tie-break, and an opaque keyset cursor that is read with a schema, so one that was cut, edited or made up is a 400.

type World = Awaited<ReturnType<typeof overrideWorld>>;

/** Reads every page of the list of the scoped repository of tenant 1 with `limit`, following the cursors, and answers the pages. */
async function allPages(world: World, limit: number) {
  const pages: ReturnType<typeof pageOf>[] = [];
  let cursor: string | null = null;
  do {
    const query: string = cursor === null ? `?limit=${limit}` : `?limit=${limit}&cursor=${cursor}`;
    const response = await listOverridesAs(world, 'admin1', world.t1.scoped.repositoryId, query);
    expect(response.statusCode).toBe(200);
    const page = pageOf(response);
    pages.push(page);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return pages;
}

/** 120 overrides in groups of three that share their instant to the second, so the id has to break every tie. */
const ties = (): SeededOverride[] =>
  Array.from({ length: 120 }, (_unused, index) => ({
    commitSha: shaOf(index + 1),
    createdAt: `2026-10-01T10:${String(Math.floor(index / 3)).padStart(2, '0')}:00Z`,
  }));

test('120 overrides with ties on their instant are read in pages of 50 without a duplicate or a gap, newest first', async () => {
  const world = await overrideWorld();
  await seedOverrides(world, scopedOf(world.t1), ties());
  const expected = await world.db
    .selectFrom('commit_overrides')
    .select('id')
    .where('repository_id', '=', world.t1.scoped.repositoryId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  const pages = await allPages(world, 50);
  expect(pages.map((page) => page.items.length)).toEqual([50, 50, 20]);
  expect(pages.map((page) => page.nextCursor === null)).toEqual([false, false, true]);
  const ids = pages.flatMap((page) => page.items.map((item) => item.id));
  expect(ids).toEqual(expected.map((row) => row.id));
  expect(new Set(ids).size).toBe(120);
});

test('two overrides recorded within one millisecond are told apart by the microseconds of the cursor, one page after the other, with none skipped', async () => {
  const world = await overrideWorld();
  await seedOverrides(world, scopedOf(world.t1), [
    { commitSha: shaOf(1), createdAt: '2026-10-01T10:00:00.123403Z' },
    { commitSha: shaOf(2), createdAt: '2026-10-01T10:00:00.123401Z' },
    { commitSha: shaOf(3), createdAt: '2026-10-01T10:00:00.123402Z' },
  ]);
  const pages = await allPages(world, 1);
  expect(pages.flatMap((page) => page.items.map((item) => item.commitSha))).toEqual([shaOf(1), shaOf(3), shaOf(2)]);
  expect(pages.map((page) => page.items.length)).toEqual([1, 1, 1]);
});

test('a list that holds exactly the limit is one page with no cursor, and one more row makes a second page with that row only', async () => {
  const world = await overrideWorld();
  await seedOverrides(world, scopedOf(world.t1), ties().slice(0, 3));
  expect((await allPages(world, 3)).map((page) => [page.items.length, page.nextCursor])).toEqual([[3, null]]);
  await seedOverrides(world, scopedOf(world.t1), [{ commitSha: shaOf(500), createdAt: '2026-09-01T00:00:00Z' }]);
  expect((await allPages(world, 3)).map((page) => page.items.length)).toEqual([3, 1]);
});

test('the page holds 50 overrides when the request names no limit, and 100 at most', async () => {
  const world = await overrideWorld();
  await seedOverrides(world, scopedOf(world.t1), ties());
  const byDefault = pageOf(await listOverridesAs(world, 'admin1', world.t1.scoped.repositoryId));
  const largest = pageOf(await listOverridesAs(world, 'admin1', world.t1.scoped.repositoryId, '?limit=100'));
  const smallest = pageOf(await listOverridesAs(world, 'admin1', world.t1.scoped.repositoryId, '?limit=1'));
  expect([byDefault.items.length, largest.items.length, smallest.items.length]).toEqual([50, 100, 1]);
  expect(largest.nextCursor).not.toBeNull();
});

test.each([
  ['zero', '?limit=0'],
  ['above 100', '?limit=101'],
  ['a word', '?limit=many'],
  ['negative', '?limit=-1'],
  ['fractional', '?limit=1.5'],
  ['with a leading zero', '?limit=050'],
  ['empty', '?limit='],
  ['a parameter nobody defined', '?offset=10'],
  ['an empty cursor', '?cursor='],
])('%s is 400 bad_request', async (_name, query) => {
  const world = await overrideWorld();
  const response = await listOverridesAs(world, 'admin1', world.t1.scoped.repositoryId, query);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([400, 'bad_request']);
});

const cursorOf = (position: unknown): string => Buffer.from(JSON.stringify(position)).toString('base64url');

test.each([
  ['text that is not base64url', 'not a cursor!'],
  ['base64url of text that is not JSON', Buffer.from('zzzz').toString('base64url')],
  ['an empty object', cursorOf({})],
  ['a position with the instant only', cursorOf(['2026-10-01T10:00:00.000000Z'])],
  ['a position with a third element', cursorOf(['2026-10-01T10:00:00.000000Z', 1, 2])],
  ['an instant to the millisecond, which the server never makes', cursorOf(['2026-10-01T10:00:00.000Z', 1])],
  ['an instant with an offset', cursorOf(['2026-10-01T10:00:00.000000+01:00', 1])],
  ['an instant in the year 0', cursorOf(['0000-01-01T00:00:00.000000Z', 1])],
  ['a text that is not an instant', cursorOf(['yesterday', 1])],
  ['an id of zero', cursorOf(['2026-10-01T10:00:00.000000Z', 0])],
  ['an id that is a text', cursorOf(['2026-10-01T10:00:00.000000Z', '1'])],
  ['a position of the list of the allowlist', cursorOf(['user', 'octocat', 1])],
])('a cursor made of %s is 400 bad_request and nothing is read with it', async (_name, cursor) => {
  const world = await overrideWorld();
  const response = await listOverridesAs(world, 'admin1', world.t1.scoped.repositoryId, `?cursor=${cursor}`);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([400, 'bad_request']);
});

test('a cursor the server made, with a character appended or changed, is 400', async () => {
  const world = await overrideWorld();
  await seedOverrides(world, scopedOf(world.t1), ties().slice(0, 3));
  const first = pageOf(await listOverridesAs(world, 'admin1', world.t1.scoped.repositoryId, '?limit=1'));
  const cursor = first.nextCursor ?? '';
  expect(cursor).not.toBe('');
  const padded = await listOverridesAs(world, 'admin1', world.t1.scoped.repositoryId, `?cursor=${cursor}=`);
  const edited = await listOverridesAs(world, 'admin1', world.t1.scoped.repositoryId, `?cursor=${cursor}A`);
  expect([padded.statusCode, edited.statusCode]).toEqual([400, 400]);
});

test('a cursor does not widen what the person may read: it is read after the role, so a stranger is 404 whatever it holds', async () => {
  const world = await overrideWorld();
  const response = await listOverridesAs(world, 'outsider', world.t1.scoped.repositoryId, '?cursor=not a cursor!');
  expect(response.statusCode).toBe(404);
});
