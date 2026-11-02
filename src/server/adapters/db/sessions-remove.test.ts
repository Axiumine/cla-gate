// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { createSessionStore } from './sessions.ts';
import { LIMITS, runtimeSessionsWorld, sessionIdsOf, sessionsWorld, T0 } from './sessions-fixture/test-support.ts';
import { asRuntimeRole } from './test-support.ts';

// Ending one session on purpose (E10-S05): the row named, and no other.

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
