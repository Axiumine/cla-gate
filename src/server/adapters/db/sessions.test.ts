// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { CreatedSession } from './sessions.ts';
import {
  after,
  countSessions,
  HOUR,
  present,
  SECOND,
  sessionsWorld,
  sha256Hex,
  T0,
} from './sessions-fixture/test-support.ts';

// The session store (E10-S01): what is stored, what is found and what is touched.

const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;

test('create returns a 43 character base64url id and stores only its SHA-256, never the id', async () => {
  const { db, store, alice } = await sessionsWorld();
  const created = await store.create({ userId: alice }, T0);
  expect(created.id).toMatch(BASE64URL_43);
  const rows = await db.selectFrom('sessions').selectAll().execute();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.session_hash).toBe(sha256Hex(created.id));
  expect(rows[0]?.session_hash).toMatch(/^[0-9a-f]{64}$/);
  // Neither column holds the plain id, and the CSRF secret is another value of its own.
  expect(Object.values(rows[0] ?? {})).not.toContain(created.id);
  expect(rows[0]?.csrf_secret).toBe(created.csrfSecret);
  expect(created.csrfSecret).toMatch(BASE64URL_43);
  expect(created.csrfSecret).not.toBe(created.id);
  expect(created.rowId).toBe(rows[0]?.id);
});

test('the stored hash is not a credential: looking a session up by its hash finds nothing', async () => {
  const { store, alice } = await sessionsWorld();
  const created = await store.create({ userId: alice }, T0);
  expect(await store.findLive(sha256Hex(created.id), T0)).toBeUndefined();
  expect(await store.findLive(created.id, T0)).toBeDefined();
});

test('ids and CSRF secrets are random: 200 sessions, no value twice', async () => {
  const { store, alice, bob } = await sessionsWorld();
  const created: CreatedSession[] = [];
  for (let index = 0; index < 100; index += 1) {
    created.push(await store.create({ userId: index % 2 === 0 ? alice : bob }, after(index)));
  }
  expect(new Set(created.map((session) => session.id)).size).toBe(100);
  expect(new Set(created.map((session) => session.csrfSecret)).size).toBe(100);
});

test('create stores the times of newTimes: created and last seen now, idle after 8 hours, absolute after 7 days', async () => {
  const { db, store, alice } = await sessionsWorld();
  const created = await store.create({ userId: alice }, T0);
  expect(created.idleExpiresAt).toEqual(after(8 * HOUR));
  expect(created.absoluteExpiresAt).toEqual(after(7 * 24 * HOUR));
  const row = await db.selectFrom('sessions').selectAll().executeTakeFirstOrThrow();
  expect([row.created_at, row.last_seen_at, row.idle_expires_at, row.absolute_expires_at]).toEqual([
    T0,
    T0,
    created.idleExpiresAt,
    created.absoluteExpiresAt,
  ]);
});

test('findLive returns the session with its user row', async () => {
  const { store, alice, db } = await sessionsWorld();
  await db.updateTable('users').set({ avatar_url: 'https://avatars.githubusercontent.com/u/1001' }).execute();
  const created = await store.create({ userId: alice }, T0);
  expect(await store.findLive(created.id, after(HOUR))).toEqual({
    rowId: created.rowId,
    user: {
      id: alice,
      githubId: 1001,
      login: 'login-1001',
      name: 'Name 1001',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1001',
    },
    csrfSecret: created.csrfSecret,
    createdAt: T0,
    lastSeenAt: T0,
    idleExpiresAt: created.idleExpiresAt,
    absoluteExpiresAt: created.absoluteExpiresAt,
  });
});

test.each([
  ['a well-formed id nobody has', 'A'.repeat(43)],
  ['the empty string', ''],
  ['text that is not an id', "' or 1=1 --"],
])('findLive finds nothing for %s', async (_label, id) => {
  const { store, alice } = await sessionsWorld();
  await store.create({ userId: alice }, T0);
  expect(await store.findLive(id, T0)).toBeUndefined();
});

test('a session is live one millisecond before its idle expiry and dead, and deleted, exactly at it', async () => {
  const { db, store, alice } = await sessionsWorld();
  const created = await store.create({ userId: alice }, T0);
  const expiry = created.idleExpiresAt.getTime();
  expect(await store.findLive(created.id, new Date(expiry - 1))).toBeDefined();
  expect(await countSessions(db)).toBe(1);
  expect(await store.findLive(created.id, new Date(expiry))).toBeUndefined();
  expect(await countSessions(db)).toBe(0);
});

test('a dead row is deleted when it is found, and a later lookup finds nothing', async () => {
  const { db, store, alice } = await sessionsWorld();
  const created = await store.create({ userId: alice }, T0);
  expect(await store.findLive(created.id, after(9 * HOUR))).toBeUndefined();
  expect(await countSessions(db)).toBe(0);
  expect(await store.findLive(created.id, T0)).toBeUndefined();
});

test('a session past its absolute expiry is dead although it was used a moment ago', async () => {
  const { db, store, alice } = await sessionsWorld();
  const id = 'B'.repeat(43);
  await db
    .insertInto('sessions')
    .values({
      session_hash: sha256Hex(id),
      user_id: alice,
      csrf_secret: 'csrf',
      created_at: after(-HOUR),
      last_seen_at: T0,
      idle_expires_at: after(SECOND),
      absolute_expires_at: after(SECOND),
    })
    .execute();
  expect(await store.findLive(id, after(SECOND - 1))).toBeDefined();
  expect(await store.findLive(id, after(SECOND))).toBeUndefined();
  expect(await countSessions(db)).toBe(0);
});

test('finding a dead session deletes that row only', async () => {
  const { db, store, alice, bob } = await sessionsWorld();
  const mine = await store.create({ userId: alice }, T0);
  const theirs = await store.create({ userId: bob }, after(5 * HOUR));
  expect(await store.findLive(mine.id, after(9 * HOUR))).toBeUndefined();
  expect(await countSessions(db)).toBe(1);
  expect(await store.findLive(theirs.id, after(9 * HOUR))).toBeDefined();
});

test('touch writes nothing when the session was last seen 60 seconds ago or less', async () => {
  const { db, store, alice } = await sessionsWorld();
  const created = await store.create({ userId: alice }, T0);
  const session = await store.findLive(created.id, T0);
  expect(session).toBeDefined();
  for (const seconds of [0, 1, 59, 60]) {
    const touched = await store.touch(present(session), after(seconds * SECOND));
    expect(touched).toBe(session);
  }
  const row = await db.selectFrom('sessions').selectAll().executeTakeFirstOrThrow();
  expect([row.last_seen_at, row.idle_expires_at]).toEqual([T0, created.idleExpiresAt]);
});

test('touch moves last seen and the idle expiry when the session was last seen more than 60 seconds ago', async () => {
  const { db, store, alice } = await sessionsWorld();
  const created = await store.create({ userId: alice }, T0);
  const session = await store.findLive(created.id, T0);
  const now = after(60 * SECOND + 1);
  const touched = await store.touch(present(session), now);
  expect(touched.lastSeenAt).toEqual(now);
  expect(touched.idleExpiresAt).toEqual(after(60 * SECOND + 1 + 8 * HOUR));
  expect(touched.absoluteExpiresAt).toEqual(created.absoluteExpiresAt);
  const row = await db.selectFrom('sessions').selectAll().executeTakeFirstOrThrow();
  expect([row.last_seen_at, row.idle_expires_at, row.absolute_expires_at]).toEqual([
    now,
    touched.idleExpiresAt,
    created.absoluteExpiresAt,
  ]);
  // The next touch is measured from the new last-seen time, not from the login.
  expect((await store.touch(touched, after(60 * SECOND + 1 + 60 * SECOND))).lastSeenAt).toEqual(now);
});

test('a session in use for a week slides every hour and never idles past its absolute expiry', async () => {
  const { db, store, alice } = await sessionsWorld();
  const created = await store.create({ userId: alice }, T0);
  let session = await store.findLive(created.id, T0);
  for (let hour = 1; hour <= 7 * 24 - 1; hour += 1) {
    const now = after(hour * HOUR);
    session = await store.touch(present(session), now);
    expect(session.idleExpiresAt.getTime()).toBeLessThanOrEqual(created.absoluteExpiresAt.getTime());
  }
  const last = after((7 * 24 - 1) * HOUR);
  expect(session?.idleExpiresAt).toEqual(created.absoluteExpiresAt);
  const row = await db.selectFrom('sessions').selectAll().executeTakeFirstOrThrow();
  expect(row.idle_expires_at).toEqual(created.absoluteExpiresAt);
  expect(await store.findLive(created.id, last)).toBeDefined();
  expect(await store.findLive(created.id, created.absoluteExpiresAt)).toBeUndefined();
});

test('a session that nobody uses dies at its idle expiry although the absolute one is far away', async () => {
  const { store, alice } = await sessionsWorld();
  const created = await store.create({ userId: alice }, T0);
  const used = await store.findLive(created.id, after(7 * HOUR));
  const touched = await store.touch(present(used), after(7 * HOUR));
  expect(touched.idleExpiresAt).toEqual(after(15 * HOUR));
  expect(await store.findLive(created.id, after(15 * HOUR - 1))).toBeDefined();
  expect(await store.findLive(created.id, after(15 * HOUR))).toBeUndefined();
});

test('the fixture helper that narrows a lookup passes a value through and refuses undefined', () => {
  expect(present(0)).toBe(0);
  expect(present('value')).toBe('value');
  expect(() => {
    present(undefined);
  }).toThrow('expected a value, got undefined');
});
