// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { unlockResponseSchema } from '../../../shared/setup.ts';
import { AUTH_ENV } from '../../config/auth-fixture/test-support.ts';
import { FakeClock } from '../../services/test-support.ts';
import { testApp } from '../../test-support.ts';
import { getSetupSession, postManifest, setupApp, unlockSetup } from './setup-fixture/test-support.ts';

// E19-S07: `GET /api/setup/session` gives a page that GitHub sent the browser back to the CSRF token of its setup session
// again, on the strength of the cookie alone. It exists in setup mode only.

const MINUTE = 60_000;

test('with the cookie of a live session it answers the CSRF token of that session, and nothing else', async () => {
  const { app } = await setupApp();
  const unlocked = await unlockSetup(app);
  const response = await getSetupSession(app, unlocked.cookie);
  expect(response.statusCode).toBe(200);
  expect(unlockResponseSchema.parse(response.json())).toEqual({ csrfToken: unlocked.csrfToken });
  expect(response.json()).toEqual({ csrfToken: unlocked.csrfToken });
});

test('the answer is never stored by a cache, and the cookie is set again with its 30 minutes', async () => {
  const { app } = await setupApp();
  const unlocked = await unlockSetup(app);
  const response = await getSetupSession(app, unlocked.cookie);
  expect(response.headers['cache-control']).toBe('no-store');
  const [cookie] = response.cookies;
  expect(`${cookie?.name}=${cookie?.value}`).toBe(unlocked.cookie);
  expect(cookie?.maxAge).toBe(1800);
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.secure).toBe(true);
  expect(cookie?.sameSite).toBe('Strict');
});

test('the token it gives is the one the manifest accepts, so a page after the round trip can carry on', async () => {
  const { app } = await setupApp();
  const unlocked = await unlockSetup(app);
  const { csrfToken } = unlockResponseSchema.parse((await getSetupSession(app, unlocked.cookie)).json());
  expect((await postManifest(app, unlocked, { csrfToken })).statusCode).toBe(200);
});

test.each([
  ['no cookie', undefined],
  ['a cookie with the id of no session', `__Host-cla_setup=${'a'.repeat(43)}`],
  ['an empty cookie', '__Host-cla_setup='],
  ['a cookie of another name', '__Host-cla_other=x'],
])('%s is 401 setup_locked, with no token in the answer', async (_what, cookie) => {
  const { app } = await setupApp();
  const unlocked = await unlockSetup(app);
  const response = await getSetupSession(app, cookie);
  expect(response.statusCode).toBe(401);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('setup_locked');
  expect(response.body).not.toContain(unlocked.csrfToken);
  expect(response.headers['set-cookie']).toBeUndefined();
});

test('a session idle for more than 30 minutes is gone, and a read inside the 30 minutes starts the idle time over', async () => {
  const clock = new FakeClock('2026-11-03T09:00:00.000Z');
  const { app } = await setupApp({ clock });
  const unlocked = await unlockSetup(app);
  clock.advance(29 * MINUTE);
  expect((await getSetupSession(app, unlocked.cookie)).statusCode).toBe(200);
  clock.advance(29 * MINUTE);
  expect((await getSetupSession(app, unlocked.cookie)).statusCode).toBe(200);
  clock.advance(30 * MINUTE + 1);
  expect((await getSetupSession(app, unlocked.cookie)).statusCode).toBe(401);
});

test('it is a route of setup mode only: a configured server answers the standard 404, with or without a cookie', async () => {
  const { app } = await testApp({ env: AUTH_ENV });
  for (const headers of [{}, { cookie: `__Host-cla_setup=${'a'.repeat(43)}` }]) {
    const response = await app.inject({ method: 'GET', url: '/api/setup/session', headers });
    expect(response.statusCode).toBe(404);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe('not_found');
  }
});

test('it reads no body and takes no other method: a POST is the standard 404 of a route that is not there', async () => {
  const { app } = await setupApp();
  const unlocked = await unlockSetup(app);
  const response = await app.inject({
    method: 'POST',
    url: '/api/setup/session',
    headers: { cookie: unlocked.cookie },
  });
  expect(response.statusCode).toBeGreaterThanOrEqual(400);
  expect(response.statusCode).toBeLessThan(500);
});
