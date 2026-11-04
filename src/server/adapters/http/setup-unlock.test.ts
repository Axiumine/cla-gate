// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { unlockResponseSchema } from '../../../shared/setup.ts';
import { TEST_SETUP_TOKEN } from '../../config/test-support.ts';
import { postUnlock, setupApp, unlockSetup } from './setup-fixture/test-support.ts';

// E19-S06: `POST /api/setup/unlock` compares the token in constant time, opens an in-memory session on the right one and
// answers a wrong one with `401 invalid_setup_token`. Bodies are small and strict.

const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/u;
const JSON_TYPE = { 'content-type': 'application/json' };

test('the right token opens a session: 200 with the CSRF token in the body and the cookie of the session', async () => {
  const { app } = await setupApp();
  const response = await postUnlock(app, TEST_SETUP_TOKEN);
  expect(response.statusCode).toBe(200);
  const { csrfToken } = unlockResponseSchema.parse(response.json());
  expect(csrfToken).toMatch(BASE64URL_43);
  expect(response.headers['cache-control']).toBe('no-store');
  const [cookie] = response.cookies;
  expect(cookie?.name).toBe('__Host-cla_setup');
  expect(cookie?.value).toMatch(BASE64URL_43);
  expect(cookie?.value).not.toBe(csrfToken);
});

test('the cookie is __Host-: HttpOnly, Secure, SameSite=Strict, Path=/, no Domain, and 30 minutes idle', async () => {
  const { app } = await setupApp();
  const header = (await postUnlock(app, TEST_SETUP_TOKEN)).headers['set-cookie'];
  const attributes = String(header)
    .split('; ')
    .slice(1)
    .toSorted((a, b) => a.localeCompare(b));
  expect(attributes).toEqual(['HttpOnly', 'Max-Age=1800', 'Path=/', 'SameSite=Strict', 'Secure']);
});

test('every unlock is a session of its own: a new id and a new CSRF token each time', async () => {
  const { app } = await setupApp();
  const first = await unlockSetup(app);
  const second = await unlockSetup(app);
  expect(second.cookie).not.toBe(first.cookie);
  expect(second.csrfToken).not.toBe(first.csrfToken);
});

test('the unlock asks for no Origin and no cookie: it is what opens the session', async () => {
  const { app } = await setupApp();
  const response = await app.inject({ method: 'POST', url: '/api/setup/unlock', payload: { token: TEST_SETUP_TOKEN } });
  expect(response.statusCode).toBe(200);
});

test.each([
  ['a prefix of the token', TEST_SETUP_TOKEN.slice(0, -1)],
  ['the token and one more character', `${TEST_SETUP_TOKEN}x`],
  ['the token in upper case', TEST_SETUP_TOKEN.toUpperCase()],
  ['the token and a line feed', `${TEST_SETUP_TOKEN}\n`],
  ['the token with a space in front', ` ${TEST_SETUP_TOKEN}`],
  ['a single character', 'x'],
  ['a token of the longest allowed length', 'a'.repeat(512)],
])('%s is 401 invalid_setup_token and opens nothing', async (_what, token) => {
  const { app } = await setupApp();
  const response = await postUnlock(app, token);
  expect(response.statusCode).toBe(401);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('invalid_setup_token');
  expect(response.headers['set-cookie']).toBeUndefined();
});

test.each([
  ['no token', {}],
  ['an empty token', { token: '' }],
  ['a number', { token: 7 }],
  ['null', { token: null }],
  ['a list', { token: ['a'] }],
  ['an object', { token: { a: 1 } }],
  ['a token of 513 characters', { token: 'a'.repeat(513) }],
  ['a key besides the token', { token: TEST_SETUP_TOKEN, remember: true }],
  ['a list instead of an object', [TEST_SETUP_TOKEN]],
  ['a string instead of an object', TEST_SETUP_TOKEN],
])('a body with %s is 400 bad_request, even beside the right token', async (_what, payload) => {
  const { app } = await setupApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api/setup/unlock',
    headers: JSON_TYPE,
    payload: JSON.stringify(payload),
  });
  expect(response.statusCode).toBe(400);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('bad_request');
  expect(response.headers['set-cookie']).toBeUndefined();
});

test.each([
  ['JSON that does not parse', JSON_TYPE, '{"token":'],
  ['no body with the JSON type', JSON_TYPE, ''],
])('%s is a 400', async (_what, headers, payload) => {
  const { app } = await setupApp();
  const response = await app.inject({ method: 'POST', url: '/api/setup/unlock', headers, payload });
  expect(response.statusCode).toBe(400);
});

test('a body that is not JSON is 415, as everywhere', async () => {
  const { app } = await setupApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api/setup/unlock',
    headers: { 'content-type': 'text/plain' },
    payload: TEST_SETUP_TOKEN,
  });
  expect(response.statusCode).toBe(415);
});

/** A JSON body of exactly `bytes` bytes: `{"token":"aaa…"}`. */
function bodyOfSize(bytes: number): string {
  return `{"token":"${'a'.repeat(bytes - '{"token":""}'.length)}"}`;
}

test('the body limit is 4 KiB: 4096 bytes are read (and refused as a token that is too long), one more is 413', async () => {
  const { app } = await setupApp();
  const atLimit = await app.inject({
    method: 'POST',
    url: '/api/setup/unlock',
    headers: JSON_TYPE,
    payload: bodyOfSize(4096),
  });
  expect(atLimit.statusCode).toBe(400);
  const over = await app.inject({
    method: 'POST',
    url: '/api/setup/unlock',
    headers: JSON_TYPE,
    payload: bodyOfSize(4097),
  });
  expect(over.statusCode).toBe(413);
  expect(errorResponseSchema.parse(over.json()).error.code).toBe('payload_too_large');
});

test('the token, the CSRF token and the session id never reach the log, for the right token or a wrong one', async () => {
  const { app, logs } = await setupApp();
  const wrong = await postUnlock(app, 'LEAKCANARY-wrong-token');
  const unlocked = await unlockSetup(app);
  expect(wrong.statusCode).toBe(401);
  expect(logs.text()).toContain('invalid_setup_token');
  expect(logs.text()).not.toContain('LEAKCANARY');
  expect(logs.text()).not.toContain(TEST_SETUP_TOKEN);
  expect(logs.text()).not.toContain(unlocked.csrfToken);
  expect(logs.text()).not.toContain(unlocked.cookie.split('=')[1]);
});
