// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { sessionResponseSchema } from '../../../shared/auth.ts';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { authWorld, COOKIE_NAME } from './auth-fixture/test-support.ts';

// GET /api/auth/session (E10-S02): who the SPA is logged in as, and the 401 that tells it to log in.

const CLEARED = `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;

test('a live session gets 200 with the display snapshot and when the session ends, and nothing internal', async () => {
  const { app, login } = await authWorld();
  const alice = await login(1001);
  const response = await app.inject({ url: '/api/auth/session', headers: { cookie: alice.cookie } });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    user: { githubId: 1001, login: 'login-1001', name: 'Name 1001', avatarUrl: null },
    expiresAt: '2026-11-02T18:00:00.000Z',
  });
  expect(sessionResponseSchema.parse(response.json()).user.githubId).toBe(1001);
  expect(response.headers['set-cookie']).toBeUndefined();
  expect(response.body).not.toContain(alice.csrfSecret);
  expect(response.body).not.toContain(alice.id);
});

test('expiresAt follows use: the idle expiry slides forward', async () => {
  const { app, advance, login } = await authWorld();
  const alice = await login(1001);
  advance(3600);
  const response = await app.inject({ url: '/api/auth/session', headers: { cookie: alice.cookie } });
  expect(sessionResponseSchema.parse(response.json()).expiresAt).toBe('2026-11-02T19:00:00.000Z');
});

test('expiresAt is the absolute expiry once sliding would pass it', async () => {
  const { app, advance, login } = await authWorld({ SESSION_IDLE_SECONDS: '600', SESSION_ABSOLUTE_SECONDS: '1200' });
  const alice = await login(1001);
  advance(500);
  expect((await app.inject({ url: '/api/auth/session', headers: { cookie: alice.cookie } })).statusCode).toBe(200);
  advance(500);
  const response = await app.inject({ url: '/api/auth/session', headers: { cookie: alice.cookie } });
  expect(sessionResponseSchema.parse(response.json()).expiresAt).toBe('2026-11-02T10:20:00.000Z');
});

test('two people each see their own identity', async () => {
  const { app, login } = await authWorld();
  const alice = await login(1001);
  const bob = await login(2002);
  const asAlice = await app.inject({ url: '/api/auth/session', headers: { cookie: alice.cookie } });
  const asBob = await app.inject({ url: '/api/auth/session', headers: { cookie: bob.cookie } });
  const seen = [asAlice, asBob].map((response) => sessionResponseSchema.parse(response.json()).user.githubId);
  expect(seen).toEqual([1001, 2002]);
});

test('without a cookie it answers 401 with the standard body and sets no cookie', async () => {
  const { app } = await authWorld();
  const response = await app.inject('/api/auth/session');
  expect(response.statusCode).toBe(401);
  const body = errorResponseSchema.parse(response.json());
  expect(body.error.code).toBe('unauthorized');
  expect(body.error.requestId).toBe(response.headers['x-request-id']);
  expect(response.headers['set-cookie']).toBeUndefined();
});

test('a cookie with a valid id but an expired row gets 401, the cookie is cleared and the row is gone', async () => {
  const { app, advance, db, login } = await authWorld();
  const alice = await login(1001);
  advance(8 * 3600);
  const response = await app.inject({ url: '/api/auth/session', headers: { cookie: alice.cookie } });
  expect(response.statusCode).toBe(401);
  expect(response.headers['set-cookie']).toBe(CLEARED);
  expect(await db.selectFrom('sessions').selectAll().execute()).toEqual([]);
});

test('a session is still live one second before its idle expiry', async () => {
  const { app, advance, login } = await authWorld();
  const alice = await login(1001);
  advance(8 * 3600 - 1);
  expect((await app.inject({ url: '/api/auth/session', headers: { cookie: alice.cookie } })).statusCode).toBe(200);
});

test('a session past its absolute expiry is dead however recently it was used', async () => {
  const { app, advance, login } = await authWorld({ SESSION_IDLE_SECONDS: '600', SESSION_ABSOLUTE_SECONDS: '900' });
  const alice = await login(1001);
  advance(500);
  expect((await app.inject({ url: '/api/auth/session', headers: { cookie: alice.cookie } })).statusCode).toBe(200);
  advance(400);
  const response = await app.inject({ url: '/api/auth/session', headers: { cookie: alice.cookie } });
  expect(response.statusCode).toBe(401);
  expect(response.headers['set-cookie']).toBe(CLEARED);
});

test('a forged id of the right shape gets 401 and the cookie is cleared', async () => {
  const { app, login } = await authWorld();
  await login(1001);
  const response = await app.inject({
    url: '/api/auth/session',
    headers: { cookie: `${COOKIE_NAME}=${'B'.repeat(43)}` },
  });
  expect(response.statusCode).toBe(401);
  expect(response.headers['set-cookie']).toBe(CLEARED);
});

test.each([
  ['an id of 42 characters', `${COOKIE_NAME}=${'B'.repeat(42)}`],
  ['an id of 44 characters', `${COOKIE_NAME}=${'B'.repeat(44)}`],
  ['an empty value', `${COOKIE_NAME}=`],
  ['characters outside base64url', `${COOKIE_NAME}=${'+'.repeat(43)}`],
  ['a broken percent escape', `${COOKIE_NAME}=%E0%A4%A`],
  ['a very long value', `${COOKIE_NAME}=${'B'.repeat(8000)}`],
  ['two cookies of the same name', `${COOKIE_NAME}=${'B'.repeat(43)}; ${COOKIE_NAME}=${'C'.repeat(43)}`],
])('%s gets 401, clears the cookie and never reaches the database', async (_label, cookie) => {
  const { app, queries } = await authWorld();
  queries.length = 0;
  const response = await app.inject({ url: '/api/auth/session', headers: { cookie } });
  expect(response.statusCode).toBe(401);
  expect(response.headers['set-cookie']).toBe(CLEARED);
  expect(queries).toEqual([]);
});

test('two cookies of the same name are unusable even when one is a live session', async () => {
  const { app, login } = await authWorld();
  const alice = await login(1001);
  const response = await app.inject({
    url: '/api/auth/session',
    headers: { cookie: `${alice.cookie}; ${COOKIE_NAME}=${'C'.repeat(43)}` },
  });
  expect(response.statusCode).toBe(401);
});

test.each([
  ['a cookie of another name', 'session=abc'],
  ['the name without the prefix', `cla_session=${'B'.repeat(43)}`],
  ['the name in lower case', `__host-cla_session=${'B'.repeat(43)}`],
])('%s is no session: 401 without a Set-Cookie and without a query', async (_label, cookie) => {
  const { app, queries } = await authWorld();
  queries.length = 0;
  const response = await app.inject({ url: '/api/auth/session', headers: { cookie } });
  expect(response.statusCode).toBe(401);
  expect(response.headers['set-cookie']).toBeUndefined();
  expect(queries).toEqual([]);
});

test('the session id of one person does not work after that person logged out elsewhere: a deleted row is a 401', async () => {
  const { app, db, login } = await authWorld();
  const alice = await login(1001);
  await db.deleteFrom('sessions').where('id', '=', alice.sessionId).execute();
  const response = await app.inject({ url: '/api/auth/session', headers: { cookie: alice.cookie } });
  expect(response.statusCode).toBe(401);
  expect(response.headers['set-cookie']).toBe(CLEARED);
});
