// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { AUTH_ENV } from '../../config/auth-fixture/test-support.ts';
import { testApp } from '../../test-support.ts';
import { setupApp } from './setup-fixture/test-support.ts';
import { INDEX_HTML, webFixture } from './spa-fixture/test-support.ts';

// E19-S06: the setup routes exist only in setup mode. The status is always there; the unlock, the manifest and the browser
// pages of the setup answer the standard 404 once the GitHub App is configured.

const HTML = { accept: 'text/html' };

/** A built app to serve: `development` serves none, because the Vite dev server does. */
const served = (): Record<string, string> => ({ NODE_ENV: 'test', WEB_ROOT: webFixture().root });

/** A configured server: the login settings are the App's client id and secret, so the mode is `normal` with a token set or not. */
const CONFIGURED_ENV = { ...AUTH_ENV, GITHUB_APP_ID: '12345' };

test('in setup mode the status says setup, and no cache keeps the answer', async () => {
  const { app } = await setupApp();
  const response = await app.inject('/api/setup/status');
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ mode: 'setup' });
  expect(response.headers['cache-control']).toBe('no-store');
});

test('in normal mode the status says configured', async () => {
  const { app } = await testApp({ env: AUTH_ENV });
  const response = await app.inject('/api/setup/status');
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ mode: 'configured' });
});

test('a setup token that is set while the App is configured does not turn the setup back on', async () => {
  const { app } = await setupApp({ env: CONFIGURED_ENV });
  expect((await app.inject('/api/setup/status')).json()).toEqual({ mode: 'configured' });
  const unlock = await app.inject({ method: 'POST', url: '/api/setup/unlock', payload: { token: 'anything' } });
  expect(unlock.statusCode).toBe(404);
});

test('the status is answered without a session and without the database', async () => {
  const { app } = await setupApp();
  const response = await app.inject({
    url: '/api/setup/status',
    headers: { cookie: `__Host-cla_session=${'a'.repeat(43)}` },
  });
  expect(response.statusCode).toBe(200);
});

test.each<['GET' | 'POST' | 'DELETE', string]>([
  ['POST', '/api/setup/unlock'],
  ['POST', '/api/setup/manifest'],
  ['POST', '/api/setup/convert'],
  ['GET', '/api/setup/unlock'],
  ['GET', '/api/setup/anything'],
  ['DELETE', '/api/setup/status'],
])('in normal mode %s %s answers the standard 404', async (method, url) => {
  const { app } = await testApp({ env: AUTH_ENV });
  const response = await app.inject({ method, url, ...(method === 'POST' ? { payload: { token: 'x' } } : {}) });
  expect(response.statusCode).toBe(404);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('not_found');
});

test('the setup mode registers the unlock, the manifest, the session read and the conversion beside the status, and normal mode the status alone', async () => {
  const setup = await setupApp();
  const normal = await testApp({ env: AUTH_ENV });
  const setupRoutes = (app: typeof setup.app) =>
    app.routeAccess.map((entry) => `${entry.method} ${entry.url}`).filter((name) => name.includes('/api/setup/'));
  expect(setupRoutes(setup.app)).toEqual([
    'GET /api/setup/status',
    'POST /api/setup/unlock',
    'POST /api/setup/manifest',
    'GET /api/setup/session',
    'POST /api/setup/convert',
  ]);
  expect(setupRoutes(normal.app)).toEqual(['GET /api/setup/status']);
});

test.each([
  ['/setup', 'text/html'],
  ['/setup/callback', 'text/html'],
  ['/setup/callback?code=abc&state=def', 'text/html'],
  ['/setup/', 'text/html'],
  ['/SETUP', 'text/html'],
  ['/Setup/Callback', 'text/html'],
  ['/setup', '*/*'],
  ['/setup/%63allback', 'text/html'],
])('in normal mode %s answers the standard 404 and not the app (accept %s)', async (url, accept) => {
  const { app } = await testApp({ env: { ...AUTH_ENV, ...served() } });
  const response = await app.inject({ url, headers: { accept } });
  expect(response.statusCode).toBe(404);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('not_found');
  expect(response.body).not.toContain('fixture-index');
});

test.each(['/', '/signatures', '/setup-guide', '/settings', '/setupx/callback'])(
  'in normal mode %s is still the app: only the setup page and what is below it are hidden',
  async (url) => {
    const { app } = await testApp({ env: { ...AUTH_ENV, ...served() } });
    const response = await app.inject({ url, headers: HTML });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(INDEX_HTML);
  },
);

test.each(['/setup', '/setup/callback', '/setup/callback?code=abc&state=def'])(
  'in setup mode %s is the app, which shows the setup page',
  async (url) => {
    const { app } = await setupApp({ env: served() });
    const response = await app.inject({ url, headers: HTML });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(INDEX_HTML);
  },
);

test('HEAD /setup in normal mode is a 404 too', async () => {
  const { app } = await testApp({ env: { ...AUTH_ENV, ...served() } });
  expect((await app.inject({ method: 'HEAD', url: '/setup', headers: HTML })).statusCode).toBe(404);
});
