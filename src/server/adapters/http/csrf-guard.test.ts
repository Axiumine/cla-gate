// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { AUTH_ENV } from '../../config/auth-fixture/test-support.ts';
import { testApp, testConfig } from '../../test-support.ts';
import { authWorld, COOKIE_NAME, expectedToken } from './auth-fixture/test-support.ts';

// The guard on every state-changing request (E10-S03): Origin, then a live session, then the CSRF token. Each row of a
// table is one case; the app is configured for https://app.example.com and the person is logged in.

const ORIGIN = 'https://app.example.com';
const ENV = { PUBLIC_BASE_URL: ORIGIN };

/** The error code of a response, checked against the standard body. */
function codeOf(response: { json: () => unknown }): string {
  return errorResponseSchema.parse(response.json()).error.code;
}

test.each([
  ['a cross-origin page', 'https://evil.example'],
  ['Origin: null (a sandboxed frame or a redirect chain)', 'null'],
  ['no Origin header', undefined],
  ['a host that starts with ours', 'https://app.example.com.evil.example'],
  ['http instead of https', 'http://app.example.com'],
  ['our host on another port', 'https://app.example.com:8443'],
  ['a sub-domain of ours', 'https://sub.app.example.com'],
  ['our origin with a trailing slash', 'https://app.example.com/'],
  ['our origin in capitals', 'HTTPS://APP.EXAMPLE.COM'],
  ['our origin followed by another', 'https://app.example.com, https://evil.example'],
  ['an empty Origin', ''],
])('%s is 403 origin_not_allowed, though the session and the token are right', async (_label, origin) => {
  const { app, login } = await authWorld(ENV);
  const alice = await login(1001);
  const headers = { cookie: alice.cookie, 'x-csrf-token': alice.token, ...(origin === undefined ? {} : { origin }) };
  const response = await app.inject({ method: 'POST', url: '/probe/mutate', headers, payload: { a: 1 } });
  expect(response.statusCode).toBe(403);
  expect(codeOf(response)).toBe('origin_not_allowed');
  expect(response.body).not.toContain('"a"');
});

test.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
  '%s without an Origin is refused and with the right session, Origin and token is served',
  async (method) => {
    const { app, login } = await authWorld(ENV);
    const alice = await login(1001);
    const withoutOrigin = { cookie: alice.cookie, 'x-csrf-token': alice.token };
    const refused = await app.inject({ method, url: '/probe/mutate', headers: withoutOrigin });
    expect(refused.statusCode).toBe(403);
    expect(codeOf(refused)).toBe('origin_not_allowed');
    const served = await app.inject({ method, url: '/probe/mutate', headers: { ...alice.headers, origin: ORIGIN } });
    expect(served.statusCode).toBe(200);
    expect(served.json()).toEqual({ method, body: null });
  },
);

test('the Origin is checked first: a wrong one with no session is 403, not 401', async () => {
  const { app } = await authWorld(ENV);
  const response = await app.inject({
    method: 'POST',
    url: '/probe/mutate',
    headers: { origin: 'https://evil.example' },
  });
  expect(response.statusCode).toBe(403);
  expect(codeOf(response)).toBe('origin_not_allowed');
});

test.each([
  ['no cookie at all', undefined],
  ['a forged id of the right shape', `${COOKIE_NAME}=${'B'.repeat(43)}`],
  ['an id of the wrong length', `${COOKIE_NAME}=${'B'.repeat(42)}`],
  ['a cookie of another name', `session=${'B'.repeat(43)}`],
])('the right Origin and %s is 401 unauthorized, whatever token comes with it', async (_label, cookie) => {
  const { app, login } = await authWorld(ENV);
  const alice = await login(1001);
  const headers = { origin: ORIGIN, 'x-csrf-token': alice.token, ...(cookie === undefined ? {} : { cookie }) };
  const response = await app.inject({ method: 'POST', url: '/probe/mutate', headers });
  expect(response.statusCode).toBe(401);
  expect(codeOf(response)).toBe('unauthorized');
});

test('a session that expired is 401, not a token check', async () => {
  const { app, advance, login } = await authWorld(ENV);
  const alice = await login(1001);
  advance(8 * 3600);
  const response = await app.inject({ method: 'POST', url: '/probe/mutate', headers: alice.headers });
  expect(response.statusCode).toBe(401);
  expect(codeOf(response)).toBe('unauthorized');
});

test('the session is checked before the token: no session and no token is 401', async () => {
  const { app } = await authWorld(ENV);
  const response = await app.inject({ method: 'POST', url: '/probe/mutate', headers: { origin: ORIGIN } });
  expect(response.statusCode).toBe(401);
});

test('a missing token with a live session is 403 csrf_invalid', async () => {
  const { app, login } = await authWorld(ENV);
  const alice = await login(1001);
  const response = await app.inject({
    method: 'POST',
    url: '/probe/mutate',
    headers: { cookie: alice.cookie, origin: ORIGIN },
  });
  expect(response.statusCode).toBe(403);
  expect(codeOf(response)).toBe('csrf_invalid');
});

test.each([
  ['an empty token', () => ''],
  ['a token one character short', (token: string) => token.slice(0, 42)],
  ['a token one character long', (token: string) => `${token}A`],
  ['a very long token', () => 'A'.repeat(10_000)],
  ['a token with spaces around it', (token: string) => ` ${token} `],
  [
    'a token of the right length with one character changed',
    (token: string) => `${token.slice(0, 42)}${token.endsWith('A') ? 'B' : 'A'}`,
  ],
  ['a token of the right length made of one letter', () => 'A'.repeat(43)],
  ['the same token twice', (token: string) => `${token}, ${token}`],
])('%s is 403 csrf_invalid and does not throw', async (_label, mangle) => {
  const { app, login } = await authWorld(ENV);
  const alice = await login(1001);
  const headers = { ...alice.headers, 'x-csrf-token': mangle(alice.token) };
  const response = await app.inject({ method: 'POST', url: '/probe/mutate', headers });
  expect(response.statusCode).toBe(403);
  expect(codeOf(response)).toBe('csrf_invalid');
});

test('the secret of the session is not a token, and neither is the session id', async () => {
  const { app, login } = await authWorld(ENV);
  const alice = await login(1001);
  for (const wrong of [alice.csrfSecret, alice.id]) {
    const response = await app.inject({
      method: 'POST',
      url: '/probe/mutate',
      headers: { ...alice.headers, 'x-csrf-token': wrong },
    });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain(wrong);
  }
});

test('a token from another session is 403, though both people are logged in', async () => {
  const { app, login } = await authWorld(ENV);
  const alice = await login(1001);
  const bob = await login(2002);
  expect(alice.token).not.toBe(bob.token);
  const response = await app.inject({
    method: 'POST',
    url: '/probe/mutate',
    headers: { ...alice.headers, 'x-csrf-token': bob.token },
  });
  expect(response.statusCode).toBe(403);
  expect(codeOf(response)).toBe('csrf_invalid');
});

test('a second session of the same person has its own token: the first one does not work on it', async () => {
  const { app, login } = await authWorld(ENV);
  const laptop = await login(1001);
  const phone = await login(1001);
  expect(laptop.token).not.toBe(phone.token);
  const crossed = await app.inject({
    method: 'POST',
    url: '/probe/mutate',
    headers: { ...phone.headers, 'x-csrf-token': laptop.token },
  });
  expect(crossed.statusCode).toBe(403);
  expect((await app.inject({ method: 'POST', url: '/probe/mutate', headers: phone.headers })).statusCode).toBe(200);
});

test('after logout the old cookie is 401 and the old token is refused on the next session', async () => {
  const { app, db, login } = await authWorld(ENV);
  const before = await login(1001);
  expect((await app.inject({ method: 'POST', url: '/probe/mutate', headers: before.headers })).statusCode).toBe(200);
  await db.deleteFrom('sessions').where('id', '=', before.sessionId).execute();
  const dead = await app.inject({ method: 'POST', url: '/probe/mutate', headers: before.headers });
  expect(dead.statusCode).toBe(401);
  const after = await login(1001);
  const replayed = await app.inject({
    method: 'POST',
    url: '/probe/mutate',
    headers: { ...after.headers, 'x-csrf-token': before.token },
  });
  expect(replayed.statusCode).toBe(403);
  expect(codeOf(replayed)).toBe('csrf_invalid');
  expect((await app.inject({ method: 'POST', url: '/probe/mutate', headers: after.headers })).statusCode).toBe(200);
});

test('a token minted before SESSION_SECRET was rotated is 403, and one minted under the new secret is accepted', async () => {
  const rotated = 'rotated-session-secret-0123456789a';
  expect(rotated).not.toBe(AUTH_ENV['SESSION_SECRET']);
  const { app, login } = await authWorld({ ...ENV, SESSION_SECRET: rotated });
  const alice = await login(1001);
  const old = await app.inject({ method: 'POST', url: '/probe/mutate', headers: alice.headers });
  expect(old.statusCode).toBe(403);
  expect(codeOf(old)).toBe('csrf_invalid');
  const fresh = expectedToken(rotated, alice.csrfSecret);
  const headers = { ...alice.headers, 'x-csrf-token': fresh };
  expect((await app.inject({ method: 'POST', url: '/probe/mutate', headers })).statusCode).toBe(200);
});

test('the token the session route hands out is the one the guard accepts, and the header name is case-insensitive', async () => {
  const { app, login } = await authWorld(ENV);
  const alice = await login(1001);
  const session = await app.inject({ url: '/api/auth/session', headers: { cookie: alice.cookie } });
  const { csrfToken } = session.json<{ csrfToken: string }>();
  const response = await app.inject({
    method: 'POST',
    url: '/probe/mutate',
    headers: { cookie: alice.cookie, origin: ORIGIN, 'X-CSRF-Token': csrfToken },
    payload: { hello: 'world' },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ method: 'POST', body: { hello: 'world' } });
});

test.each([
  ['GET', 'GET'],
  ['HEAD', 'HEAD'],
  ['OPTIONS', 'OPTIONS'],
] as const)('%s is never checked: no Origin, no session and no token is served', async (_label, method) => {
  const { app } = await authWorld(ENV);
  const response = await app.inject({ method, url: '/probe/safe', headers: { origin: 'https://evil.example' } });
  expect(response.statusCode).toBe(200);
});

test('a POST to a path no route answers is still the plain 404', async () => {
  const { app } = await authWorld(ENV);
  const response = await app.inject({ method: 'POST', url: '/nowhere' });
  expect(response.statusCode).toBe(404);
  expect(codeOf(response)).toBe('not_found');
});

test('a refused request never reaches the route and the token is not echoed or logged', async () => {
  const { app, logs, login } = await authWorld(ENV);
  const alice = await login(1001);
  const wrong = 'A'.repeat(43);
  const response = await app.inject({
    method: 'POST',
    url: '/probe/mutate',
    headers: { ...alice.headers, 'x-csrf-token': wrong },
  });
  expect(response.body).not.toContain(wrong);
  expect(response.body).not.toContain('"method"');
  expect(logs.text()).not.toContain(wrong);
  expect(logs.text()).not.toContain(alice.token);
  expect(logs.lines().find((line) => line['msg'] === 'request rejected')).toMatchObject({
    statusCode: 403,
    code: 'csrf_invalid',
  });
});

test('with login not configured the guard is still on: a wrong Origin is 403 and the right one is 401', async () => {
  const { app } = await testApp();
  app.post('/thing', () => 'reached');
  const own = new URL(testConfig().publicBaseUrl).origin;
  const wrong = await app.inject({ method: 'POST', url: '/thing', headers: { origin: 'https://evil.example' } });
  const right = await app.inject({ method: 'POST', url: '/thing', headers: { origin: own } });
  expect([wrong.statusCode, right.statusCode]).toEqual([403, 401]);
  expect(right.body).not.toContain('reached');
});
