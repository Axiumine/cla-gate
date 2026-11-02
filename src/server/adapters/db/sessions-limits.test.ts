// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  after,
  countSessions,
  HOUR,
  insertExpiredRow,
  insertSessionRow,
  SECOND,
  sessionIdsOf,
  sessionsWorld,
  T0,
} from './sessions-fixture/test-support.ts';

// The two limits of creating a session (E10-S01): at most 10 live sessions per person, and an opportunistic purge of
// up to 100 expired ones, both in the one statement that inserts.

const CHECK = { code: '23514' };

/** Ten live sessions of `userId`, created a minute apart from `T0`, oldest first (their ids). */
async function tenSessions(world: Awaited<ReturnType<typeof sessionsWorld>>, userId: number): Promise<number[]> {
  const ids: number[] = [];
  for (let index = 0; index < 10; index += 1) {
    ids.push((await world.store.create({ userId }, after(index * 60 * SECOND))).rowId);
  }
  return ids;
}

test('ten sessions of one person are all kept', async () => {
  const world = await sessionsWorld();
  const ids = await tenSessions(world, world.alice);
  expect(await sessionIdsOf(world.db, world.alice)).toEqual(ids);
});

test('the 11th session deletes the oldest one of that person, in the same statement that inserts it', async () => {
  const world = await sessionsWorld();
  const ids = await tenSessions(world, world.alice);
  const eleventh = await world.store.create({ userId: world.alice }, after(HOUR));
  expect(await sessionIdsOf(world.db, world.alice)).toEqual([...ids.slice(1), eleventh.rowId]);
});

test('after 25 creations the person holds exactly the newest ten', async () => {
  const world = await sessionsWorld();
  const created: number[] = [];
  for (let index = 0; index < 25; index += 1) {
    created.push((await world.store.create({ userId: world.alice }, after(index * SECOND))).rowId);
  }
  expect(await sessionIdsOf(world.db, world.alice)).toEqual(created.slice(-10));
});

test("another person's sessions are never evicted by the cap", async () => {
  const world = await sessionsWorld();
  const bobs = await tenSessions(world, world.bob);
  await tenSessions(world, world.alice);
  await world.store.create({ userId: world.alice }, after(HOUR));
  expect(await sessionIdsOf(world.db, world.bob)).toEqual(bobs);
  expect(await sessionIdsOf(world.db, world.alice)).toHaveLength(10);
});

test('the oldest session is the one created first, not the one with the lowest id', async () => {
  const world = await sessionsWorld();
  const base = { idleExpiresAt: after(5 * HOUR), absoluteExpiresAt: after(9 * HOUR) };
  // Inserted first (lowest id) but created last.
  const newest = await insertSessionRow(world.db, world.alice, 0, { ...base, createdAt: after(-60 * SECOND) });
  const rest: number[] = [];
  for (let index = 1; index <= 9; index += 1) {
    rest.push(await insertSessionRow(world.db, world.alice, index, { ...base, createdAt: after(-(index + 1) * HOUR) }));
  }
  const oldest = rest[8] ?? 0;
  const created = await world.store.create({ userId: world.alice }, T0);
  const left = await sessionIdsOf(world.db, world.alice);
  expect(left).not.toContain(oldest);
  expect(left).toHaveLength(10);
  expect(left).toContain(newest);
  expect(left).toContain(created.rowId);
});

test('sessions created in the same instant are evicted in the order of their ids', async () => {
  const world = await sessionsWorld();
  const base = { createdAt: T0, idleExpiresAt: after(5 * HOUR), absoluteExpiresAt: after(9 * HOUR) };
  const ids: number[] = [];
  for (let index = 0; index < 10; index += 1) {
    ids.push(await insertSessionRow(world.db, world.alice, index, base));
  }
  const created = await world.store.create({ userId: world.alice }, T0);
  expect(await sessionIdsOf(world.db, world.alice)).toEqual([...ids.slice(1), created.rowId]);
});

test('expired sessions of the person do not count towards the cap, so a live one is not evicted for them', async () => {
  const world = await sessionsWorld();
  const live: number[] = [];
  for (let index = 0; index < 9; index += 1) {
    live.push((await world.store.create({ userId: world.alice }, after(index * SECOND))).rowId);
  }
  await insertExpiredRow(world.db, world.alice, 100);
  await insertExpiredRow(world.db, world.alice, 101);
  const created = await world.store.create({ userId: world.alice }, after(HOUR));
  expect(await sessionIdsOf(world.db, world.alice)).toEqual([...live, created.rowId]);
});

test('a creation that fails deletes nothing: the cap and the purge are part of the insert', async () => {
  const world = await sessionsWorld();
  const ids = await tenSessions(world, world.alice);
  await insertExpiredRow(world.db, world.bob, 100);
  const tooMany = Array.from({ length: 21 }, (_, index) => ({ email: `a${index}@example.test`, primary: false }));
  await expect(world.store.create({ userId: world.alice, verifiedEmails: tooMany }, after(HOUR))).rejects.toMatchObject(
    CHECK,
  );
  expect(await sessionIdsOf(world.db, world.alice)).toEqual(ids);
  expect(await sessionIdsOf(world.db, world.bob)).toHaveLength(1);
});

test('creating a session deletes the expired ones of everybody', async () => {
  const world = await sessionsWorld();
  const mine = await insertExpiredRow(world.db, world.alice, 100);
  const theirs = await insertExpiredRow(world.db, world.bob, 101);
  const live = await world.store.create({ userId: world.bob }, T0);
  expect(await sessionIdsOf(world.db, world.alice)).toEqual([]);
  expect(await sessionIdsOf(world.db, world.bob)).toEqual([live.rowId]);
  expect([mine, theirs]).not.toContain(live.rowId);
});

test('a session is purged when its idle expiry is now and kept one millisecond before', async () => {
  const world = await sessionsWorld();
  const times = { createdAt: after(-HOUR), absoluteExpiresAt: after(HOUR) };
  const atNow = await insertSessionRow(world.db, world.bob, 1, { ...times, idleExpiresAt: T0 });
  const justLive = await insertSessionRow(world.db, world.bob, 2, { ...times, idleExpiresAt: after(1) });
  await world.store.create({ userId: world.alice }, T0);
  const left = await sessionIdsOf(world.db, world.bob);
  expect(left).not.toContain(atNow);
  expect(left).toEqual([justLive]);
});

test('an idle-expired session and an absolute-expired session are both purged, live ones are not', async () => {
  const world = await sessionsWorld();
  const idleExpired = await insertSessionRow(world.db, world.bob, 1, {
    createdAt: after(-9 * HOUR),
    idleExpiresAt: after(-HOUR),
    absoluteExpiresAt: after(HOUR),
  });
  const absoluteExpired = await insertSessionRow(world.db, world.bob, 2, {
    createdAt: after(-8 * 24 * HOUR),
    idleExpiresAt: after(-SECOND),
    absoluteExpiresAt: after(-SECOND),
  });
  const live = await insertSessionRow(world.db, world.bob, 3, {
    createdAt: after(-HOUR),
    idleExpiresAt: after(HOUR),
    absoluteExpiresAt: after(2 * HOUR),
  });
  await world.store.create({ userId: world.alice }, T0);
  const left = await sessionIdsOf(world.db, world.bob);
  expect(left).toEqual([live]);
  expect(left).not.toContain(idleExpired);
  expect(left).not.toContain(absoluteExpired);
});

test('one creation deletes at most 100 expired sessions, the next ones the rest', async () => {
  const world = await sessionsWorld();
  for (let index = 0; index < 130; index += 1) {
    await insertExpiredRow(world.db, world.bob, index);
  }
  await world.store.create({ userId: world.alice }, T0);
  expect(await sessionIdsOf(world.db, world.bob)).toHaveLength(30);
  expect(await countSessions(world.db)).toBe(31);
  await world.store.create({ userId: world.alice }, after(SECOND));
  expect(await sessionIdsOf(world.db, world.bob)).toHaveLength(0);
  expect(await countSessions(world.db)).toBe(2);
});

test('exactly 100 expired sessions are all deleted by one creation', async () => {
  const world = await sessionsWorld();
  for (let index = 0; index < 100; index += 1) {
    await insertExpiredRow(world.db, world.bob, index);
  }
  await world.store.create({ userId: world.alice }, T0);
  expect(await sessionIdsOf(world.db, world.bob)).toHaveLength(0);
});
