// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import crypto from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { expect, test } from 'vitest';
import { TEST_CLIENT_SECRET } from '../../config/auth-fixture/test-support.ts';
import { type CallbackWorld, callbackWorld, setCookies } from './callback-fixture/test-support.ts';
import { OAUTH_COOKIE_NAME } from './login-fixture/test-support.ts';

// GET /api/auth/callback (E10-S05), the hostile side: a request that does not come from the browser that started the login, a
// cookie nobody signed, a state that is not ours, a code used twice, a query built to be long, repeated or empty. Each ends at
// the login-failed screen with a closed reason, the attempt cookie cleared and no call to GitHub that could have been avoided.

const OAUTH_CLEARED = `${OAUTH_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
const OTHER_SECRET = 'another-session-secret-0123456789';

/** Asserts the answer of a refused callback and that nothing was written. */
async function expectRefused(world: CallbackWorld, response: LightMyRequestResponse, reason: string): Promise<void> {
  expect(response.statusCode).toBe(302);
  expect(response.headers.location).toBe(`/login/failed?reason=${reason}`);
  expect(setCookies(response)).toEqual([OAUTH_CLEARED]);
  expect(await world.db.selectFrom('users').select('id').execute()).toEqual([]);
  expect(await world.db.selectFrom('sessions').select('id').execute()).toEqual([]);
}

/** A cookie header with `value` signed the way the server signs, under `secret`. */
function signedCookie(secret: string, value: string): string {
  const signature = crypto.createHmac('sha256', secret).update(value).digest('base64').replaceAll('=', '');
  const signed = `${value}.${signature}`;
  return `${OAUTH_COOKIE_NAME}=${encodeURIComponent(signed)}`;
}

const attemptWith = (s: string, overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({ s, v: 'v'.repeat(43), r: '/', t: Date.parse('2026-11-02T10:00:00.000Z'), ...overrides });

test('a callback without the attempt cookie is a state mismatch and GitHub is never called', async () => {
  const world = await callbackWorld();
  const started = await world.start();
  const code = world.github.grant(started.location);
  const response = await world.callback({ query: { code, state: started.state } });
  await expectRefused(world, response, 'state_mismatch');
  expect(world.github.requests).toEqual([]);
});

test.each([
  [
    'a flipped character in the signature',
    (cookie: string) => `${cookie.slice(0, -1)}${cookie.endsWith('A') ? 'B' : 'A'}`,
  ],
  [
    'a value without a signature',
    (_cookie: string, state: string) => `${OAUTH_COOKIE_NAME}=${encodeURIComponent(attemptWith(state))}`,
  ],
  ['an empty value', () => `${OAUTH_COOKIE_NAME}=`],
  ['text that is no signed value', () => `${OAUTH_COOKIE_NAME}=garbage`],
])('%s is a state mismatch', async (_label, tamper) => {
  const world = await callbackWorld();
  const started = await world.start();
  const code = world.github.grant(started.location);
  const cookie = tamper(started.cookie, started.state);
  const response = await world.callback({ query: { code, state: started.state }, cookie });
  await expectRefused(world, response, 'state_mismatch');
  expect(world.github.requests).toEqual([]);
});

test('a cookie whose value was changed under its old signature is a state mismatch (a hostile return path)', async () => {
  const world = await callbackWorld();
  const started = await world.start('/dashboard');
  const code = world.github.grant(started.location);
  const signed = decodeURIComponent(started.cookie.slice(OAUTH_COOKIE_NAME.length + 1));
  const signature = signed.slice(signed.lastIndexOf('.'));
  const forged = `${attemptWith(started.state, { r: 'https://evil.example/' })}${signature}`;
  const cookie = `${OAUTH_COOKIE_NAME}=${encodeURIComponent(forged)}`;
  const response = await world.callback({ query: { code, state: started.state }, cookie });
  await expectRefused(world, response, 'state_mismatch');
});

test('a cookie signed with another secret is a state mismatch, even when its state is the right one', async () => {
  const world = await callbackWorld();
  const started = await world.start();
  const code = world.github.grant(started.location);
  const cookie = signedCookie(OTHER_SECRET, attemptWith(started.state));
  const response = await world.callback({ query: { code, state: started.state }, cookie });
  await expectRefused(world, response, 'state_mismatch');
  expect(world.github.requests).toEqual([]);
});

test.each([
  ['not JSON', 'not json'],
  ['JSON of another shape', JSON.stringify({ state: 'x' })],
  ['an array', JSON.stringify(['s', 'v', 'r', 0])],
  ['an extra key', attemptWith('x'.repeat(43), { extra: true })],
  ['a missing time', JSON.stringify({ s: 'x'.repeat(43), v: 'v'.repeat(43), r: '/' })],
  ['a time that is text', attemptWith('x'.repeat(43), { t: '2026' })],
  ['an empty state', attemptWith('')],
  ['an empty verifier', attemptWith('x'.repeat(43), { v: '' })],
])('a validly signed cookie that is %s is a state mismatch', async (_label, value) => {
  const world = await callbackWorld();
  const started = await world.start();
  const code = world.github.grant(started.location);
  const cookie = `${OAUTH_COOKIE_NAME}=${encodeURIComponent(world.app.signCookie(value))}`;
  const response = await world.callback({ query: { code, state: started.state }, cookie });
  await expectRefused(world, response, 'state_mismatch');
  expect(world.github.requests).toEqual([]);
});

test('an expired attempt is a state mismatch: the cookie is good for 600 seconds and not one more', async () => {
  const world = await callbackWorld();
  const started = await world.start();
  const code = world.github.grant(started.location);
  world.advance(600);
  const response = await world.callback({ query: { code, state: started.state }, cookie: started.cookie });
  await expectRefused(world, response, 'state_mismatch');
  expect(world.github.requests).toEqual([]);
});

test('an attempt one millisecond short of its 600 seconds still completes', async () => {
  const world = await callbackWorld();
  const started = await world.start();
  const code = world.github.grant(started.location);
  world.clock.advance(599_999);
  const response = await world.callback({ query: { code, state: started.state }, cookie: started.cookie });
  expect(response.headers.location).toBe('/');
});

test('an attempt that claims to start in the future is a state mismatch', async () => {
  const world = await callbackWorld();
  const started = await world.start();
  const code = world.github.grant(started.location);
  const future = attemptWith(started.state, { t: Date.parse('2026-11-02T10:00:00.001Z') });
  const cookie = `${OAUTH_COOKIE_NAME}=${encodeURIComponent(world.app.signCookie(future))}`;
  const response = await world.callback({ query: { code, state: started.state }, cookie });
  await expectRefused(world, response, 'state_mismatch');
});

test.each([
  ['another state of the same length', (state: string) => `${state.slice(0, -1)}${state.endsWith('A') ? 'B' : 'A'}`],
  ['a shorter state', (state: string) => state.slice(0, -1)],
  ['a longer state', (state: string) => `${state}A`],
  ['an empty state', () => ''],
  [
    'the state in other case',
    (state: string) => (state.toUpperCase() === state ? state.toLowerCase() : state.toUpperCase()),
  ],
])('%s is a state mismatch', async (_label, change) => {
  const world = await callbackWorld();
  const started = await world.start();
  const code = world.github.grant(started.location);
  const response = await world.callback({ query: { code, state: change(started.state) }, cookie: started.cookie });
  await expectRefused(world, response, 'state_mismatch');
  expect(world.github.requests).toEqual([]);
});

test('a callback without a state is a state mismatch', async () => {
  const world = await callbackWorld();
  const started = await world.start();
  const code = world.github.grant(started.location);
  const response = await world.callback({ query: { code }, cookie: started.cookie });
  await expectRefused(world, response, 'state_mismatch');
});

test('the earlier tab of two login starts ends in a state mismatch and the later one logs in', async () => {
  const world = await callbackWorld();
  const first = await world.start('/one');
  const second = await world.start('/two');
  const firstCode = world.github.grant(first.location);
  const secondCode = world.github.grant(second.location);
  // The browser holds one cookie of that name: the second start overwrote the first.
  const early = await world.callback({ query: { code: firstCode, state: first.state }, cookie: second.cookie });
  await expectRefused(world, early, 'state_mismatch');
  const late = await world.callback({ query: { code: secondCode, state: second.state }, cookie: second.cookie });
  expect(late.headers.location).toBe('/two');
});

test('login CSRF: a code the attacker obtained for his own attempt does not log the victim in', async () => {
  const world = await callbackWorld();
  const victim = await world.start();
  const attacker = await world.start('/attacker');
  const attackerCode = world.github.grant(attacker.location);
  // The victim is lured to the callback URL with the attacker's code and state; the victim's browser holds the victim's cookie.
  const response = await world.callback({
    query: { code: attackerCode, state: attacker.state },
    cookie: victim.cookie,
  });
  await expectRefused(world, response, 'state_mismatch');
  expect(world.github.requests).toEqual([]);
});

test('a code granted for another attempt is refused at GitHub by the PKCE verifier, whatever the state says', async () => {
  const world = await callbackWorld();
  const victim = await world.start();
  const attacker = await world.start();
  const attackerCode = world.github.grant(attacker.location);
  // The victim's own state and cookie, the attacker's code: the verifier in the cookie does not match that code's challenge.
  const response = await world.callback({ query: { code: attackerCode, state: victim.state }, cookie: victim.cookie });
  expect(response.headers.location).toBe('/login/failed?reason=exchange_failed');
  expect(world.github.issued).toEqual([]);
  expect(await world.db.selectFrom('sessions').select('id').execute()).toEqual([]);
});

test('a replayed code logs nobody in: the cookie is gone, and with the cookie GitHub refuses the used code', async () => {
  const world = await callbackWorld();
  const started = await world.start();
  const code = world.github.grant(started.location);
  const query = { code, state: started.state };
  const first = await world.callback({ query, cookie: started.cookie });
  expect(first.headers.location).toBe('/');
  const withoutCookie = await world.callback({ query });
  expect(withoutCookie.headers.location).toBe('/login/failed?reason=state_mismatch');
  const withCookie = await world.callback({ query, cookie: started.cookie });
  expect(withCookie.headers.location).toBe('/login/failed?reason=exchange_failed');
  expect(await world.db.selectFrom('sessions').select('id').execute()).toHaveLength(1);
  expect(world.github.issued).toHaveLength(1);
});

test('a hostile return path inside a validly signed cookie is replaced by the front page', async () => {
  const world = await callbackWorld();
  const started = await world.start();
  const code = world.github.grant(started.location);
  const hostile = attemptWith(started.state, { v: started.sent.attempt.v, r: '//evil.example/' });
  const cookie = `${OAUTH_COOKIE_NAME}=${encodeURIComponent(world.app.signCookie(hostile))}`;
  const response = await world.callback({ query: { code, state: started.state }, cookie });
  expect(response.statusCode).toBe(302);
  expect(response.headers.location).toBe('/');
});

test.each([
  ['a code of 513 characters', (s: string) => ({ code: 'c'.repeat(513), state: s })],
  ['a state of 513 characters', (s: string) => ({ code: 'c', state: `${s}${'s'.repeat(513 - s.length)}` })],
  ['an error of 513 characters', (s: string) => ({ error: 'e'.repeat(513), state: s })],
  ['an empty code', (s: string) => ({ code: '', state: s })],
  ['a repeated code', (s: string) => ({ code: ['a', 'b'], state: s })],
  ['a repeated state', (s: string) => ({ code: 'c', state: [s, s] })],
  ['a repeated error', (s: string) => ({ error: ['access_denied', 'access_denied'], state: s })],
])('%s is a bad request, with the attempt cookie cleared', async (_label, query) => {
  const world = await callbackWorld();
  const started = await world.start();
  const response = await world.callback({ query: query(started.state), cookie: started.cookie });
  await expectRefused(world, response, 'bad_request');
  expect(world.github.requests).toEqual([]);
});

test('a code of exactly 512 characters is accepted as far as the query goes', async () => {
  const world = await callbackWorld();
  const started = await world.start();
  const response = await world.callback({
    query: { code: 'c'.repeat(512), state: started.state },
    cookie: started.cookie,
  });
  expect(response.headers.location).toBe('/login/failed?reason=exchange_failed');
  expect(world.github.requests).toHaveLength(1);
});

test('a callback with a state and no code is a bad request', async () => {
  const world = await callbackWorld();
  const started = await world.start();
  const response = await world.callback({ query: { state: started.state }, cookie: started.cookie });
  await expectRefused(world, response, 'bad_request');
  expect(world.github.requests).toEqual([]);
});

test('a callback with nothing at all is a state mismatch, not a server error', async () => {
  const world = await callbackWorld();
  const response = await world.callback({ query: {} });
  await expectRefused(world, response, 'state_mismatch');
});

test('a person who cancels at GitHub ends at access_denied, and GitHub is not called', async () => {
  const world = await callbackWorld();
  const started = await world.start();
  const query = {
    error: 'access_denied',
    error_description: 'The user has denied your application access.',
    error_uri: 'https://docs.github.com/apps',
    state: started.state,
  };
  const response = await world.callback({ query, cookie: started.cookie });
  await expectRefused(world, response, 'access_denied');
  expect(world.github.requests).toEqual([]);
});

test('any other error from GitHub is a failed exchange', async () => {
  const world = await callbackWorld();
  const started = await world.start();
  const response = await world.callback({
    query: { error: 'redirect_uri_mismatch', state: started.state },
    cookie: started.cookie,
  });
  await expectRefused(world, response, 'exchange_failed');
  expect(world.github.requests).toEqual([]);
});

test('an error with a code too is judged as an error: the code is not used', async () => {
  const world = await callbackWorld();
  const started = await world.start();
  const code = world.github.grant(started.location);
  const query = { error: 'access_denied', code, state: started.state };
  const response = await world.callback({ query, cookie: started.cookie });
  await expectRefused(world, response, 'access_denied');
  expect(world.github.requests).toEqual([]);
});

test('a cancellation that carries the wrong state is a state mismatch: nothing in the query is believed without the cookie', async () => {
  const world = await callbackWorld();
  const started = await world.start();
  const forged = await world.callback({ query: { error: 'access_denied', state: 'forged' }, cookie: started.cookie });
  await expectRefused(world, forged, 'state_mismatch');
  const stranger = await world.callback({ query: { error: 'access_denied', state: started.state } });
  await expectRefused(world, stranger, 'state_mismatch');
});

test('the code and the state never reach the logs, whichever way the callback ended', async () => {
  const world = await callbackWorld();
  const started = await world.start();
  const code = world.github.grant(started.location);
  await world.callback({ query: { code, state: 'forged-state' }, cookie: started.cookie });
  await world.callback({ query: { code, state: started.state }, cookie: started.cookie });
  await world.callback({ query: { code, state: started.state }, cookie: started.cookie });
  const text = world.logs.text();
  expect(text).toContain('auth.login_failed');
  for (const secret of [code, started.state, started.sent.attempt.v, 'forged-state', TEST_CLIENT_SECRET]) {
    expect(text).not.toContain(secret);
  }
});
