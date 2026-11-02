// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { authWorld, COOKIE_NAME } from './auth-fixture/test-support.ts';

// POST /api/auth/logout (E10-S06) against hostile requests. Where a request carries a body it is `everywhere: true`, the
// one with the most to lose, and every case asserts that every session of both people is still there afterwards: a guard
// that failed would not show as a status code alone, it would have emptied the table.

type Headers = Record<string, string>;

const JSON_TYPE = { 'content-type': 'application/json' };

const omit = (headers: Headers, key: string): Headers =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => name !== key));

/** Alice and Bob with two sessions each, and the ids of every session row before the request under test. */
async function twoPeople() {
  const world = await authWorld();
  const alice = await world.login(1001);
  await world.login(1001);
  const bob = await world.login(2002);
  await world.login(2002);
  const rows = async () =>
    (await world.db.selectFrom('sessions').select('id').orderBy('id').execute()).map((row) => row.id);
  return { ...world, alice, bob, rows, before: await rows() };
}

test.each([
  ['no Origin', (own: Headers) => omit(own, 'origin'), 403, 'origin_not_allowed'],
  ['another origin', (own: Headers) => ({ ...own, origin: 'https://evil.example' }), 403, 'origin_not_allowed'],
  ['Origin: null', (own: Headers) => ({ ...own, origin: 'null' }), 403, 'origin_not_allowed'],
  ['no cookie', (own: Headers) => omit(own, 'cookie'), 401, 'unauthorized'],
  [
    'a forged session id of the right shape',
    (own: Headers) => ({ ...own, cookie: `${COOKIE_NAME}=${'B'.repeat(43)}` }),
    401,
    'unauthorized',
  ],
  ['no CSRF token', (own: Headers) => omit(own, 'x-csrf-token'), 403, 'csrf_invalid'],
  ['a CSRF token of the wrong length', (own: Headers) => ({ ...own, 'x-csrf-token': 'A' }), 403, 'csrf_invalid'],
  [
    "a CSRF token of the right shape that is nobody's",
    (own: Headers) => ({ ...own, 'x-csrf-token': 'A'.repeat(43) }),
    403,
    'csrf_invalid',
  ],
])('with %s the request is refused and ends no session of anybody', async (_label, tweak, status, code) => {
  const world = await twoPeople();
  const response = await world.app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: tweak(world.alice.headers),
    payload: { everywhere: true },
  });
  expect(response.statusCode).toBe(status);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe(code);
  expect(await world.rows()).toEqual(world.before);
});

test("the CSRF token of another person's session does not log this person out, nor that person", async () => {
  const world = await twoPeople();
  const response = await world.app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: { ...world.alice.headers, 'x-csrf-token': world.bob.token },
    payload: { everywhere: true },
  });
  expect(response.statusCode).toBe(403);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('csrf_invalid');
  expect(await world.rows()).toEqual(world.before);
});

test.each([
  ['a user id', { userId: 2 }],
  ['a GitHub id beside the flag', { everywhere: true, githubId: 2002 }],
  ['a session id beside the flag', { everywhere: true, sessionId: 1 }],
  ['a string for the flag', { everywhere: 'true' }],
  ['a number for the flag', { everywhere: 1 }],
  ['null for the flag', { everywhere: null }],
  ['null as the body', null],
  ['an array as the body', [true]],
  ['a bare string as the body', 'everywhere'],
])('a body with %s is 400 bad_request and ends no session of anybody', async (_label, body) => {
  const world = await twoPeople();
  const response = await world.app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: { ...world.alice.headers, ...JSON_TYPE },
    payload: JSON.stringify(body),
  });
  expect(response.statusCode).toBe(400);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('bad_request');
  expect(await world.rows()).toEqual(world.before);
});

test.each([
  ['malformed JSON', '{"everywhere": tru'],
  ['an empty body declared as JSON', ''],
])('%s is 400 and ends no session of anybody', async (_label, payload) => {
  const world = await twoPeople();
  const response = await world.app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: { ...world.alice.headers, ...JSON_TYPE },
    payload,
  });
  expect(response.statusCode).toBe(400);
  expect(await world.rows()).toEqual(world.before);
});

test.each([
  ['a urlencoded form, the shape of a cross-site form post', 'application/x-www-form-urlencoded', 'everywhere=true'],
  ['plain text', 'text/plain', '{"everywhere":true}'],
  ['multipart form data', 'multipart/form-data; boundary=xyz', '--xyz--'],
])('%s is 415 unsupported_media_type and ends no session of anybody', async (_label, type, payload) => {
  const world = await twoPeople();
  const response = await world.app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: { ...world.alice.headers, 'content-type': type },
    payload,
  });
  expect(response.statusCode).toBe(415);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('unsupported_media_type');
  expect(await world.rows()).toEqual(world.before);
});

test.each(['GET', 'PUT', 'PATCH', 'DELETE'] as const)(
  '%s on the logout path logs nobody out: only POST is the logout',
  async (method) => {
    const world = await twoPeople();
    const response = await world.app.inject({ method, url: '/api/auth/logout', headers: world.alice.headers });
    expect(response.statusCode).toBe(404);
    expect(await world.rows()).toEqual(world.before);
  },
);

test('the Origin is checked before the body: a wrong Origin with a hostile body is 403, not 400', async () => {
  const world = await twoPeople();
  const response = await world.app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: { ...world.alice.headers, ...JSON_TYPE, origin: 'https://evil.example' },
    payload: { userId: 2 },
  });
  expect(response.statusCode).toBe(403);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('origin_not_allowed');
  expect(await world.rows()).toEqual(world.before);
});

test('the session is checked before the body: no session with a hostile body is 401, not 400', async () => {
  const world = await twoPeople();
  const response = await world.app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: { ...omit(world.alice.headers, 'cookie'), ...JSON_TYPE },
    payload: { userId: 2 },
  });
  expect(response.statusCode).toBe(401);
  expect(await world.rows()).toEqual(world.before);
});
