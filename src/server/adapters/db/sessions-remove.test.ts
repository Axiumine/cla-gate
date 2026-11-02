// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { createSessionStore } from './sessions.ts';
import {
  insertExpiredRow,
  LIMITS,
  runtimeSessionsWorld,
  sessionIdsOf,
  sessionsWorld,
  T0,
} from './sessions-fixture/test-support.ts';
import { asRuntimeRole } from './test-support.ts';

// Ending sessions on purpose: one row named, and no other (E10-S05), or all of one person's (E10-S06, logout everywhere).

test('remove deletes the named session and leaves the same person other sessions and everybody else alone', async () => {
  const { db, store, alice, bob } = await sessionsWorld();
  const first = await store.create({ userId: alice }, T0);
  const second = await store.create({ userId: alice }, T0);
  const other = await store.create({ userId: bob }, T0);
  await store.remove(first.rowId);
  expect(await sessionIdsOf(db, alice)).toEqual([second.rowId]);
  expect(await sessionIdsOf(db, bob)).toEqual([other.rowId]);
  expect(await store.findLive(first.id, T0)).toBeUndefined();
  expect((await store.findLive(second.id, T0))?.rowId).toBe(second.rowId);
});

test('removing a session that is already gone is not an error', async () => {
  const { store, alice } = await sessionsWorld();
  const created = await store.create({ userId: alice }, T0);
  await store.remove(created.rowId);
  await expect(store.remove(created.rowId)).resolves.toBeUndefined();
});

test('cla_app can delete a session', async () => {
  const { db, alice } = await runtimeSessionsWorld();
  const removed = await asRuntimeRole(db, async (trx) => {
    const store = createSessionStore(trx, LIMITS);
    const created = await store.create({ userId: alice }, T0);
    await store.remove(created.rowId);
    return created.rowId;
  });
  expect(await sessionIdsOf(db, alice)).not.toContain(removed);
});

test('removeAllOfUser deletes every session of that person, expired ones too, and returns the count', async () => {
  const { db, store, alice } = await sessionsWorld();
  await store.create({ userId: alice }, T0);
  await store.create({ userId: alice }, T0);
  await store.create({ userId: alice }, T0);
  await insertExpiredRow(db, alice, 1);
  expect(await store.removeAllOfUser(alice)).toBe(4);
  expect(await sessionIdsOf(db, alice)).toEqual([]);
});

test('removeAllOfUser leaves every session of everybody else untouched', async () => {
  const { db, store, alice, bob } = await sessionsWorld();
  await store.create({ userId: alice }, T0);
  const kept = [await store.create({ userId: bob }, T0), await store.create({ userId: bob }, T0)];
  expect(await store.removeAllOfUser(alice)).toBe(1);
  expect(await sessionIdsOf(db, bob)).toEqual(kept.map((session) => session.rowId));
  expect((await store.findLive(kept[0]?.id ?? '', T0))?.user.id).toBe(bob);
});

test('removeAllOfUser returns 0 for a person with no sessions and for an id nobody has, and is repeatable', async () => {
  const { store, alice } = await sessionsWorld();
  await store.create({ userId: alice }, T0);
  expect(await store.removeAllOfUser(alice)).toBe(1);
  expect(await store.removeAllOfUser(alice)).toBe(0);
  expect(await store.removeAllOfUser(987_654)).toBe(0);
});

test("cla_app can delete every session of a user, and only that user's", async () => {
  const { db, alice, bob } = await runtimeSessionsWorld();
  const count = await asRuntimeRole(db, async (trx) => {
    const store = createSessionStore(trx, LIMITS);
    await store.create({ userId: alice }, T0);
    await store.create({ userId: alice }, T0);
    await store.create({ userId: bob }, T0);
    return store.removeAllOfUser(alice);
  });
  expect(count).toBe(2);
  expect(await sessionIdsOf(db, alice)).toEqual([]);
  expect(await sessionIdsOf(db, bob)).toHaveLength(1);
});
