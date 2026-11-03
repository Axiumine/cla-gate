// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { AUTH_ENV } from '../../config/auth-fixture/test-support.ts';
import { INDEX_HTML, SCRIPT_TEXT, SCRIPT_URL, webApp } from './spa-fixture/test-support.ts';

// E17-S03: how the file routes sit among the routes of the API and its hooks: they never shadow one, they never read the
// session, and they are limited like every other route.

const HTML = { accept: 'text/html' };
/** Shaped like a session id (43 base64url characters), so that the session hook would look it up if it ran. */
const SESSION_COOKIE = `__Host-cla_session=${'a'.repeat(43)}`;

test('the probes and the login routes are still theirs: the file routes are only the rest', async () => {
  const { app } = await webApp(AUTH_ENV);
  expect((await app.inject({ url: '/healthz', headers: HTML })).json()).toEqual({ status: 'ok' });
  const session = await app.inject({ url: '/api/auth/session', headers: HTML });
  expect(session.headers['cache-control']).toBe('no-store');
  expect(session.body).not.toContain(INDEX_HTML);
});

test('a page and a file load without a session lookup, so they load while the database is down', async () => {
  const { app } = await webApp(AUTH_ENV);
  const headers = { ...HTML, cookie: SESSION_COOKIE };
  const page = await app.inject({ url: '/signatures', headers });
  expect([page.statusCode, page.body]).toEqual([200, INDEX_HTML]);
  const root = await app.inject({ url: '/', headers: { cookie: SESSION_COOKIE } });
  expect(root.statusCode).toBe(200);
  const script = await app.inject({ url: SCRIPT_URL, headers: { cookie: SESSION_COOKIE } });
  expect([script.statusCode, script.body]).toEqual([200, SCRIPT_TEXT]);
  const missing = await app.inject({ url: '/missing.js', headers: { cookie: SESSION_COOKIE } });
  expect(missing.statusCode).toBe(404);
});

test('the same cookie on a route of the API does reach the database, which is what the test above does without', async () => {
  const { app } = await webApp(AUTH_ENV);
  const response = await app.inject({ url: '/api/auth/session', headers: { cookie: SESSION_COOKIE } });
  expect(response.statusCode).toBe(500);
});

test('no response of the file routes sets a cookie', async () => {
  const { app } = await webApp(AUTH_ENV);
  for (const url of ['/', '/signatures', SCRIPT_URL, '/missing.js']) {
    expect((await app.inject({ url, headers: HTML })).headers['set-cookie']).toBeUndefined();
  }
});

test('the files and the pages are under the global budget of a client address, 600 requests a minute', async () => {
  const { app } = await webApp();
  const statuses: number[] = [];
  for (let sent = 0; sent < 601; sent += 1) {
    statuses.push((await app.inject({ url: '/signatures', headers: HTML })).statusCode);
  }
  expect(statuses.slice(0, 600).every((status) => status === 200)).toBe(true);
  expect(statuses[600]).toBe(429);
  const refused = await app.inject({ url: SCRIPT_URL });
  expect(errorResponseSchema.parse(refused.json()).error.code).toBe('too_many_requests');
});
