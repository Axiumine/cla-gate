// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { seedSignatures } from '../../services/export/export-fixture/test-support.ts';
import { pageOf, searchWorld } from './signature-search-fixture/test-support.ts';

// The pages of `GET /api/installations/:installationId/signatures` (E15-S02): newest signature first, ties broken by the larger id,
// and a keyset cursor that holds the place of the next row.

/** 120 signatures of the installation document that share seven instants, so that most rows have a tie on `signed_at`. */
async function worldWithTies() {
  const world = await searchWorld();
  const { db, t1 } = world;
  const seeds = Array.from({ length: 120 }, (_, index) => ({ githubId: 1000 + index, signedAtMs: (index % 7) * 1000 }));
  await seedSignatures(db, t1, seeds);
  const stored = await db
    .selectFrom('signatures')
    .select('id')
    .where('installation_id', '=', t1.installationId)
    .orderBy('signed_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  return { ...world, order: stored.map((row) => row.id) };
}

/** The query string of the page of `limit` signatures after `cursor` (the first page when there is none). */
const pageQuery = (limit: number, cursor: string | null): string =>
  cursor === null ? `?limit=${limit}` : `?limit=${limit}&cursor=${cursor}`;

/** Reads every page of the search with `limit` signatures a page, and returns the ids of each. */
async function pagesOf(world: Awaited<ReturnType<typeof worldWithTies>>, limit: number): Promise<number[][]> {
  const pages: number[][] = [];
  let cursor: string | null = null;
  do {
    const page = pageOf(await world.search('admin1', world.t1.installationId, pageQuery(limit, cursor)));
    pages.push(page.items.map((item) => item.id));
    cursor = page.nextCursor;
  } while (cursor !== null);
  return pages;
}

test.each([1, 7, 25, 50, 100])(
  '120 signatures with ties on signed_at, %i to a page: no duplicate and no gap, in the order signed_at desc, id desc',
  async (limit) => {
    const world = await worldWithTies();
    const pages = await pagesOf(world, limit);
    expect(pages.flat()).toEqual(world.order);
    expect(pages.slice(0, -1).every((page) => page.length === limit)).toBe(true);
  },
);

test('the default page holds 50 signatures, the largest 100, and a page that ends the list has no cursor', async () => {
  const world = await worldWithTies();
  const { search, t1 } = world;
  const first = pageOf(await search('admin1', t1.installationId));
  expect(first.items).toHaveLength(50);
  expect(first.nextCursor).not.toBeNull();
  expect(pageOf(await search('admin1', t1.installationId, '?limit=100')).items).toHaveLength(100);
  const last = pageOf(
    await search(
      'admin1',
      t1.installationId,
      `?cursor=${pageOf(await search('admin1', t1.installationId, '?limit=100')).nextCursor}`,
    ),
  );
  expect(last.items.map((item) => item.id)).toEqual(world.order.slice(100));
  expect(last.nextCursor).toBeNull();
});

test('a list that is exactly one page long has no cursor, and the cursor of a longer one starts at the first row of the next page', async () => {
  const world = await worldWithTies();
  const { search, t1 } = world;
  const only = pageOf(await search('admin1', t1.installationId, '?limit=1&githubUserId=1005'));
  expect([only.items.length, only.nextCursor]).toEqual([1, null]);
  const { nextCursor } = pageOf(await search('admin1', t1.installationId, '?limit=10'));
  const next = pageOf(await search('admin1', t1.installationId, `?limit=10&cursor=${nextCursor}`));
  expect(next.items.map((item) => item.id)).toEqual(world.order.slice(10, 20));
});

test('the cursor holds the instant of the next row to the microsecond and its id, as the opaque text the server made', async () => {
  const world = await worldWithTies();
  const { nextCursor } = pageOf(await world.search('admin1', world.t1.installationId, '?limit=10'));
  expect(nextCursor).toMatch(/^[\w-]+$/);
  const decoded: unknown = JSON.parse(Buffer.from(nextCursor ?? '', 'base64url').toString('utf8'));
  expect(decoded).toEqual([expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/), world.order[10]]);
});
