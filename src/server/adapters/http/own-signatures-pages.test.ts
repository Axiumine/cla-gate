// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { OwnSignaturesPage } from '../../../shared/own-signatures.ts';
import { seedSignatures } from '../../services/export/export-fixture/test-support.ts';
import { ownSignaturesWorld, pageOf } from './own-signatures-fixture/test-support.ts';

// The pages of `GET /api/me/signatures` (E13-S06): the order `signed_at desc, id desc`, the opaque cursor between pages, and the
// size of a page. A person with 120 signatures, some of them at one instant, reads them in three pages with no duplicate and no gap.

const ADA = 1234;
const REVOKED = { afterMs: 1, byGithubId: 99, reason: 'signer_request' } as const;

/**
 * Ada with `count` signatures, half in each tenant, three at every instant (so a page can end between two of the same instant), all
 * of them revoked: a person may hold one signature per document and major version that is not revoked, and these are many.
 * Answers the ids in the order the list must give them.
 */
async function adaWith(count: number) {
  const world = await ownSignaturesWorld();
  const ada = await world.login(ADA);
  const seeds = Array.from({ length: count / 2 }, (_value, index) => ({
    githubId: ADA,
    signedAtMs: Math.floor(index / 3) * 1000,
    revoked: REVOKED,
  }));
  await seedSignatures(world.db, world.t1, seeds);
  await seedSignatures(world.db, world.t2, seeds);
  const rows = await world.db
    .selectFrom('signatures')
    .select(['id', 'signed_at'])
    .where('user_id', '=', ada.userId)
    .orderBy('signed_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  return { world, ada, order: rows.map((row) => row.id), instants: rows.map((row) => row.signed_at.getTime()) };
}

/** Reads every page of the list from the first, `query` being the part of the query string every page repeats; answers the pages. */
async function readAll(
  world: Awaited<ReturnType<typeof adaWith>>['world'],
  session: Parameters<typeof world.list>[0],
  query: string,
) {
  const pages: OwnSignaturesPage[] = [];
  let cursor: string | null = null;
  do {
    const joined: string = cursor === null ? query : `${query}&cursor=${cursor}`;
    const page = pageOf(await world.list(session, joined));
    pages.push(page);
    cursor = page.nextCursor;
  } while (cursor !== null && pages.length < 10);
  return pages;
}

test('120 signatures with ties on the instant are read in three pages of 50, 50 and 20: no duplicate and no gap', async () => {
  const { world, ada, order, instants } = await adaWith(120);
  expect(order).toHaveLength(120);
  expect(new Set(instants).size).toBeLessThan(120);
  const pages = await readAll(world, ada, '?limit=50');
  expect(pages.map((page) => page.items.length)).toEqual([50, 50, 20]);
  expect(pages.map((page) => page.nextCursor === null)).toEqual([false, false, true]);
  const ids = pages.flatMap((page) => page.items.map((item) => item.id));
  expect(ids).toEqual(order);
  expect(new Set(ids).size).toBe(120);
});

test('without a limit a page holds 50, and the second page holds the rest', async () => {
  const { world, ada, order } = await adaWith(120);
  const first = pageOf(await world.list(ada));
  expect(first.items.map((item) => item.id)).toEqual(order.slice(0, 50));
  const second = pageOf(await world.list(ada, `?cursor=${first.nextCursor}`));
  expect(second.items.map((item) => item.id)).toEqual(order.slice(50, 100));
});

test('a limit of 100 reads 120 signatures in two pages, and a limit of 1 in a page for each', async () => {
  const { world, ada, order } = await adaWith(120);
  const big = await readAll(world, ada, '?limit=100');
  expect(big.map((page) => page.items.length)).toEqual([100, 20]);
  expect(big.flatMap((page) => page.items.map((item) => item.id))).toEqual(order);
  const small = pageOf(await world.list(ada, '?limit=1'));
  expect(small.items.map((item) => item.id)).toEqual(order.slice(0, 1));
  expect(small.nextCursor).not.toBeNull();
});

test('a person whose signatures fill the last page exactly gets no empty page after it', async () => {
  const { world, ada, order } = await adaWith(100);
  const pages = await readAll(world, ada, '?limit=50');
  expect(pages.map((page) => page.items.length)).toEqual([50, 50]);
  expect(pages.at(-1)?.nextCursor).toBeNull();
  expect(pages.flatMap((page) => page.items.map((item) => item.id))).toEqual(order);
});

test('a signature made while the person reads the pages shows on the first page and does not shift the pages after it', async () => {
  const { world, ada, order } = await adaWith(120);
  const first = pageOf(await world.list(ada, '?limit=50'));
  const [made] = await seedSignatures(world.db, world.t1, [{ githubId: ADA, signedAtMs: 10_000_000 }]);
  const second = pageOf(await world.list(ada, `?limit=50&cursor=${first.nextCursor}`));
  expect(second.items.map((item) => item.id)).toEqual(order.slice(50, 100));
  expect(pageOf(await world.list(ada, '?limit=1')).items.map((item) => item.id)).toEqual([made]);
});
