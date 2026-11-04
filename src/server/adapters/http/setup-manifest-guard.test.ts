// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { postManifest, setupApp, unlockSetup } from './setup-fixture/test-support.ts';

// E19-S06: every setup POST besides the unlock needs the setup cookie, the CSRF token in `x-csrf-token` and an `Origin` equal
// to PUBLIC_BASE_URL, and each failure has a code of its own. The checks run in that order, before the body is read.

async function refusal(response: ReturnType<typeof postManifest>): Promise<[number, string]> {
  const settled = await response;
  return [settled.statusCode, errorResponseSchema.parse(settled.json()).error.code];
}

test.each([
  ['no Origin header', undefined],
  ['another origin', 'https://evil.example'],
  ['the same host over http', 'http://cla.example.org'],
  ['another port', 'https://cla.example.org:8443'],
  ['a sub-domain', 'https://evil.cla.example.org'],
  ['the origin with a trailing slash', 'https://cla.example.org/'],
  ['the literal null', 'null'],
  ['an empty Origin', ''],
])('%s is 403 origin_mismatch, cookie and token or not', async (_what, origin) => {
  const { app } = await setupApp();
  const unlocked = await unlockSetup(app);
  expect(await refusal(postManifest(app, unlocked, { origin }))).toEqual([403, 'origin_mismatch']);
});

test('the Origin is checked first: a request from another site with no cookie and no token learns only that', async () => {
  const { app } = await setupApp();
  const unlocked = await unlockSetup(app);
  const call = { origin: 'https://evil.example', cookie: undefined, csrfToken: undefined };
  expect(await refusal(postManifest(app, unlocked, call))).toEqual([403, 'origin_mismatch']);
});

test.each([
  ['no cookie', undefined],
  ['a cookie with the id of no session', `__Host-cla_setup=${'a'.repeat(43)}`],
  ['an empty cookie', '__Host-cla_setup='],
  ['a cookie of the login instead', `__Host-cla_session=${'a'.repeat(43)}`],
  ['a cookie of another name', 'cla_setup=x'],
])('%s is 401 setup_locked, with the right Origin and token', async (_what, cookie) => {
  const { app } = await setupApp();
  const unlocked = await unlockSetup(app);
  expect(await refusal(postManifest(app, unlocked, { cookie }))).toEqual([401, 'setup_locked']);
});

test('the cookie is checked before the token: no session and a wrong token is setup_locked', async () => {
  const { app } = await setupApp();
  const unlocked = await unlockSetup(app);
  expect(await refusal(postManifest(app, unlocked, { cookie: undefined, csrfToken: 'wrong' }))).toEqual([
    401,
    'setup_locked',
  ]);
});

test.each<[string, (token: string) => string | undefined]>([
  ['no token', () => undefined],
  ['an empty token', () => ''],
  ['a wrong token', () => 'wrong'],
  ['the token with its last character cut off', (token) => token.slice(0, -1)],
  ['the token and one more character', (token) => `${token}x`],
])('%s is 403 csrf_invalid', async (_what, change) => {
  const { app } = await setupApp();
  const unlocked = await unlockSetup(app);
  const call = { csrfToken: change(unlocked.csrfToken) };
  expect(await refusal(postManifest(app, unlocked, call))).toEqual([403, 'csrf_invalid']);
});

test('the token of another session is not the token of this one', async () => {
  const { app } = await setupApp();
  const mine = await unlockSetup(app);
  const theirs = await unlockSetup(app);
  expect(await refusal(postManifest(app, mine, { csrfToken: theirs.csrfToken }))).toEqual([403, 'csrf_invalid']);
  expect((await postManifest(app, mine)).statusCode).toBe(200);
});

test('the token is not the session id, which is only in the cookie', async () => {
  const { app } = await setupApp();
  const unlocked = await unlockSetup(app);
  const id = unlocked.cookie.slice(unlocked.cookie.indexOf('=') + 1);
  expect(await refusal(postManifest(app, unlocked, { csrfToken: id }))).toEqual([403, 'csrf_invalid']);
});

test('the checks run before the body is read: a hostile body from a caller who is not unlocked is setup_locked, not 400', async () => {
  const { app } = await setupApp();
  const unlocked = await unlockSetup(app);
  const call = { cookie: undefined, body: { ownerType: 'organisation', organisation: '../x', appName: '<b>' } };
  expect(await refusal(postManifest(app, unlocked, call))).toEqual([401, 'setup_locked']);
});

test('the manifest route has no GET: the setup POST cannot be asked for with a link', async () => {
  const { app } = await setupApp();
  const unlocked = await unlockSetup(app);
  const response = await app.inject({ url: '/api/setup/manifest', headers: { cookie: unlocked.cookie } });
  expect(response.statusCode).toBe(404);
});
