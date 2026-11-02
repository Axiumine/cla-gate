// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { type CreatedSession, createSessionStore } from './sessions.ts';
import {
  after,
  countSessions,
  HOUR,
  insertExpiredRow,
  LIMITS,
  present,
  runtimeSessionsWorld,
  SECOND,
  sessionIdsOf,
  sessionsWorld,
  T0,
} from './sessions-fixture/test-support.ts';
import { asRuntimeRole, realPostgresOnly } from './test-support.ts';

// The application connects as cla_app, which owns nothing and holds minimal grants: every statement of the session
// store must be one of them (E10-S01). PGlite enforces privileges for a role switched to with SET ROLE like Postgres does.

const EMAILS = [{ email: 'primary@example.test', primary: true }];

test('cla_app can run every statement of the store: create, find, touch, read the addresses, evict and purge', async () => {
  const { db, alice, bob } = await runtimeSessionsWorld();
  await insertExpiredRow(db, bob, 100);
  const ten = await asRuntimeRole(db, async (trx) => {
    const store = createSessionStore(trx, LIMITS);
    const created: CreatedSession[] = [];
    for (let index = 0; index < 10; index += 1) {
      created.push(await store.create({ userId: alice, verifiedEmails: EMAILS }, after(index * SECOND)));
    }
    return created;
  });
  // The purge of the expired row of bob ran as cla_app, with the first creation.
  expect(await sessionIdsOf(db, bob)).toEqual([]);

  const outcome = await asRuntimeRole(db, async (trx) => {
    const store = createSessionStore(trx, LIMITS);
    const first = present(ten[0]);
    const found = present(await store.findLive(first.id, after(HOUR)));
    const touched = await store.touch(found, after(HOUR));
    const emails = await store.verifiedEmails(found.rowId);
    const eleventh = await store.create({ userId: alice }, after(2 * HOUR));
    const dead = await store.findLive(present(ten[1]).id, after(9 * HOUR));
    return { touched, emails, eleventh, dead };
  });
  expect(outcome.touched.lastSeenAt).toEqual(after(HOUR));
  expect(outcome.emails).toEqual(EMAILS);
  expect(outcome.dead).toBeUndefined();
  // The 11th creation evicted the oldest session; the dead one was deleted by the lookup.
  const left = await sessionIdsOf(db, alice);
  expect(left).not.toContain(present(ten[0]).rowId);
  expect(left).not.toContain(present(ten[1]).rowId);
  expect(left).toContain(outcome.eleventh.rowId);
});

test('the same store works on a plain connection and inside a transaction that rolls back', async () => {
  const { db, alice } = await sessionsWorld();
  const rollback = new Error('roll back');
  await expect(
    db.transaction().execute(async (trx) => {
      await createSessionStore(trx, LIMITS).create({ userId: alice }, T0);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
  expect(await countSessions(db)).toBe(0);
});

realPostgresOnly('twelve concurrent creations for one person end with ten sessions, not eleven or more', async () => {
  const { db, store, alice } = await sessionsWorld();
  await Promise.all(Array.from({ length: 12 }, (_, index) => store.create({ userId: alice }, after(index * SECOND))));
  expect(await sessionIdsOf(db, alice)).toHaveLength(10);
});
