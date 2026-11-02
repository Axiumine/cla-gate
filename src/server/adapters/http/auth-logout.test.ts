// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { expect, onTestFinished, test, vi } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import type { Database } from '../db/schema.ts';
import { authWorld, COOKIE_NAME } from './auth-fixture/test-support.ts';

// POST /api/auth/logout (E10-S06): what logout ends, what it leaves alone, and what the old cookie and the old token are
// worth afterwards. The guards and the hostile requests are in auth-logout-guards.test.ts.

const CLEARED = `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;

type Headers = Record<string, string>;

function logout(app: FastifyInstance, headers: Headers, payload?: object) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers,
    ...(payload === undefined ? {} : { payload }),
  });
}

function whoAmI(app: FastifyInstance, cookie: string) {
  return app.inject({ url: '/api/auth/session', headers: { cookie } });
}

async function sessionRows(db: Kysely<Database>, userId: number): Promise<number[]> {
  const rows = await db.selectFrom('sessions').select('id').where('user_id', '=', userId).orderBy('id').execute();
  return rows.map((row) => row.id);
}

test('logout answers 204 with no body, clears the cookie with the attributes it was set with and is never cached', async () => {
  const { app, db, login } = await authWorld();
  const alice = await login(1001);
  const response = await logout(app, alice.headers);
  expect(response.statusCode).toBe(204);
  expect(response.body).toBe('');
  expect(response.headers['set-cookie']).toBe(CLEARED);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(await sessionRows(db, alice.userId)).toEqual([]);
});

test.each([
  ['no body', undefined],
  ['an empty object', {}],
  ['everywhere false', { everywhere: false }],
])('with %s it ends only the session in use and leaves the same person on the other device', async (_label, body) => {
  const { app, db, login } = await authWorld();
  const laptop = await login(1001);
  const phone = await login(1001);
  expect((await logout(app, laptop.headers, body)).statusCode).toBe(204);
  expect(await sessionRows(db, laptop.userId)).toEqual([phone.sessionId]);
  expect((await whoAmI(app, laptop.cookie)).statusCode).toBe(401);
  expect((await whoAmI(app, phone.cookie)).statusCode).toBe(200);
});

test('everywhere: true ends every session of the caller, expired rows included, and every old cookie gets 401', async () => {
  const { app, db, login } = await authWorld();
  const laptop = await login(1001);
  const phone = await login(1001);
  const tablet = await login(1001);
  await db
    .insertInto('sessions')
    .values({
      session_hash: 'e'.repeat(64),
      user_id: laptop.userId,
      csrf_secret: 'expired-csrf-secret',
      idle_expires_at: new Date('2026-11-02T09:00:00.000Z'),
      absolute_expires_at: new Date('2026-11-02T09:00:00.000Z'),
    })
    .execute();
  expect(await sessionRows(db, laptop.userId)).toHaveLength(4);
  const response = await logout(app, phone.headers, { everywhere: true });
  expect(response.statusCode).toBe(204);
  expect(response.headers['set-cookie']).toBe(CLEARED);
  expect(await sessionRows(db, laptop.userId)).toEqual([]);
  for (const device of [laptop, phone, tablet]) {
    expect((await whoAmI(app, device.cookie)).statusCode).toBe(401);
  }
});

test('everywhere for the first person leaves the second person with every session, live and usable', async () => {
  const { app, db, login } = await authWorld();
  const alice = await login(1001);
  await login(1001);
  const bob = await login(2002);
  const bobDevices = [bob, await login(2002), await login(2002)];
  const bobRows = await sessionRows(db, bob.userId);
  expect(bobRows).toHaveLength(3);
  expect((await logout(app, alice.headers, { everywhere: true })).statusCode).toBe(204);
  expect(await sessionRows(db, alice.userId)).toEqual([]);
  expect(await sessionRows(db, bob.userId)).toEqual(bobRows);
  for (const device of bobDevices) {
    expect((await whoAmI(app, device.cookie)).statusCode).toBe(200);
    const mutate = await app.inject({ method: 'POST', url: '/probe/mutate', headers: device.headers });
    expect(mutate.statusCode).toBe(200);
  }
});

test('a plain logout of the first person leaves the second person with every session', async () => {
  const { app, db, login } = await authWorld();
  const alice = await login(1001);
  const bob = await login(2002);
  const bobPhone = await login(2002);
  expect((await logout(app, alice.headers)).statusCode).toBe(204);
  expect(await sessionRows(db, bob.userId)).toEqual([bob.sessionId, bobPhone.sessionId]);
});

test('after logout the old cookie gets 401 from the session route, which clears it', async () => {
  const { app, login } = await authWorld();
  const alice = await login(1001);
  expect((await whoAmI(app, alice.cookie)).statusCode).toBe(200);
  await logout(app, alice.headers);
  const after = await whoAmI(app, alice.cookie);
  expect(after.statusCode).toBe(401);
  expect(errorResponseSchema.parse(after.json()).error.code).toBe('unauthorized');
  expect(after.headers['set-cookie']).toBe(CLEARED);
});

test('after logout the old CSRF token is refused on the same person next session, and the new token works', async () => {
  const { app, login } = await authWorld();
  const before = await login(1001);
  await logout(app, before.headers);
  const next = await login(1001);
  const replayed = await app.inject({
    method: 'POST',
    url: '/probe/mutate',
    headers: { ...next.headers, 'x-csrf-token': before.token },
  });
  expect(replayed.statusCode).toBe(403);
  expect(errorResponseSchema.parse(replayed.json()).error.code).toBe('csrf_invalid');
  expect((await app.inject({ method: 'POST', url: '/probe/mutate', headers: next.headers })).statusCode).toBe(200);
});

test.each([
  ['a second logout', undefined],
  ['a second logout everywhere', { everywhere: true }],
])('%s with the dead cookie is 401 unauthorized and deletes nothing of anybody else', async (_label, body) => {
  const { app, db, login } = await authWorld();
  const alice = await login(1001);
  const bob = await login(2002);
  expect((await logout(app, alice.headers)).statusCode).toBe(204);
  const second = await logout(app, alice.headers, body);
  expect(second.statusCode).toBe(401);
  expect(errorResponseSchema.parse(second.json()).error.code).toBe('unauthorized');
  expect(await sessionRows(db, bob.userId)).toEqual([bob.sessionId]);
});

test('logout makes no call to GitHub, with one session or everywhere', async () => {
  const toApp = vi.fn<typeof fetch>(() => Promise.reject(new Error('the app must not call GitHub on logout')));
  const toNetwork = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network call on logout'));
  onTestFinished(() => {
    toNetwork.mockRestore();
  });
  const { app, login } = await authWorld({}, { fetch: toApp });
  const alice = await login(1001);
  const bob = await login(2002);
  expect((await logout(app, alice.headers)).statusCode).toBe(204);
  expect((await logout(app, bob.headers, { everywhere: true })).statusCode).toBe(204);
  expect(toApp).not.toHaveBeenCalled();
  expect(toNetwork).not.toHaveBeenCalled();
});

test('logout writes no audit row and leaves the user row as it was', async () => {
  const { app, db, login } = await authWorld();
  const alice = await login(1001);
  const userBefore = await db.selectFrom('users').selectAll().where('id', '=', alice.userId).executeTakeFirstOrThrow();
  await logout(app, alice.headers, { everywhere: true });
  expect(await db.selectFrom('audit_log').select('id').execute()).toEqual([]);
  expect(await db.selectFrom('users').selectAll().where('id', '=', alice.userId).executeTakeFirstOrThrow()).toEqual(
    userBefore,
  );
});

test('the log says that a logout happened and how many sessions went, and carries no id, cookie or token', async () => {
  const { app, logs, login } = await authWorld();
  const alice = await login(1001);
  await login(1001);
  await logout(app, alice.headers, { everywhere: true });
  const line = logs.lines().find((entry) => entry['msg'] === 'auth.logout');
  expect(line).toMatchObject({ everywhere: true, removed: 2 });
  for (const secret of [alice.id, alice.token, alice.csrfSecret, alice.cookie, 'login-1001']) {
    expect(logs.text()).not.toContain(secret);
  }
});

test('the log of a plain logout says everywhere is false', async () => {
  const { app, logs, login } = await authWorld();
  const alice = await login(1001);
  await logout(app, alice.headers);
  expect(logs.lines().find((entry) => entry['msg'] === 'auth.logout')).toMatchObject({ everywhere: false });
});
