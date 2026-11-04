// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { AUTH_ENV } from '../../config/auth-fixture/test-support.ts';
import { testApp } from '../../test-support.ts';
import { setupPagePolicy } from './security.ts';
import { setupApp } from './setup-fixture/test-support.ts';
import { webFixture } from './spa-fixture/test-support.ts';

// E19-S07: the two pages of the setup post the App manifest to GitHub with a real form, so for those two HTML responses, in
// setup mode only, `form-action` says `https://github.com` too. Every other response keeps `form-action 'self'`.

const HTML = { accept: 'text/html' };
const SELF = "form-action 'self'";
const WITH_GITHUB = "form-action 'self' https://github.com";
const served = (): Record<string, string> => ({ NODE_ENV: 'test', WEB_ROOT: webFixture().root });

/** The `content-security-policy` header of a response, which every response has. */
function policyOf(headers: Record<string, unknown>): string {
  return String(headers['content-security-policy']);
}

test.each([
  ['/setup'],
  ['/setup/'],
  ['/setup/callback'],
  ['/setup/callback?code=abc123&state=def'],
  ['/SETUP'],
  ['/Setup/Callback'],
  ['/setup/%63allback'],
])('in setup mode %s lets a form post to GitHub, and the policy is otherwise the default one', async (url) => {
  const { app } = await setupApp({ env: served() });
  const fallback = policyOf((await app.inject({ url: '/', headers: HTML })).headers);
  expect(fallback).toContain(SELF);
  const response = await app.inject({ url, headers: HTML });
  expect(response.statusCode).toBe(200);
  expect(policyOf(response.headers)).toBe(fallback.replace(SELF, WITH_GITHUB));
  expect(policyOf(response.headers)).toContain(WITH_GITHUB);
});

test('a HEAD request for a setup page carries the same policy as the GET', async () => {
  const { app } = await setupApp({ env: served() });
  const get = await app.inject({ url: '/setup', headers: HTML });
  const head = await app.inject({ method: 'HEAD', url: '/setup/callback', headers: HTML });
  expect(head.statusCode).toBe(200);
  expect(policyOf(head.headers)).toBe(policyOf(get.headers));
});

test('the setup pages keep everything else of the policy: no inline script, no unsafe source, upgrade on https', async () => {
  const { app } = await setupApp({ env: served() });
  const policy = policyOf((await app.inject({ url: '/setup', headers: HTML })).headers);
  expect(policy).toBe(
    "default-src 'self';script-src 'self';style-src 'self';img-src 'self' https://avatars.githubusercontent.com;base-uri 'self';form-action 'self' https://github.com;frame-ancestors 'none';object-src 'none';upgrade-insecure-requests",
  );
  expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|data:|blob:|\*/);
  const response = await app.inject({ url: '/setup', headers: HTML });
  expect(response.headers['x-content-type-options']).toBe('nosniff');
  expect(response.headers['referrer-policy']).toBe('no-referrer');
  expect(response.headers['x-frame-options']).toBe('DENY');
});

test('on plain http the setup pages post to GitHub too and do not upgrade requests', async () => {
  const { app } = await setupApp({ env: { ...served(), PUBLIC_BASE_URL: 'http://localhost:8080' } });
  const policy = policyOf((await app.inject({ url: '/setup', headers: HTML })).headers);
  expect(policy).toContain(WITH_GITHUB);
  expect(policy).not.toContain('upgrade-insecure-requests');
});

test.each([
  ['the front page', { url: '/', headers: HTML }],
  ['index.html by name', { url: '/index.html' }],
  ['a page of the app', { url: '/signatures', headers: HTML }],
  ['a page below the setup that is not one of its two', { url: '/setup/other', headers: HTML }],
  ['a page that only starts with the name', { url: '/setup-guide', headers: HTML }],
  ['the setup status', { url: '/api/setup/status' }],
  ['a probe', { url: '/healthz' }],
  ['a missing file', { url: '/assets/none.js' }],
  ['a hashed script', { url: '/assets/app-3f9a1c.js' }],
  ['the setup path asked as data and not as a page', { url: '/setup', headers: { accept: 'application/json' } }],
  ['a POST to the setup path', { method: 'POST', url: '/setup', headers: HTML }],
])('in setup mode %s keeps form-action to this origin', async (_what, request) => {
  const { app } = await setupApp({ env: served() });
  const policy = policyOf((await app.inject(request)).headers);
  expect(policy).toContain(SELF);
  expect(policy).not.toContain('https://github.com;');
  expect(policy.replace('https://avatars.githubusercontent.com', '')).not.toContain('github.com');
});

test.each([
  ['/setup', 404],
  ['/setup/callback', 404],
  ['/', 200],
  ['/signatures', 200],
])('the relaxation does not exist outside setup mode: %s is %i and says form-action self', async (url, status) => {
  const { app } = await testApp({ env: { ...AUTH_ENV, ...served() } });
  const response = await app.inject({ url, headers: HTML });
  expect(response.statusCode).toBe(status);
  expect(policyOf(response.headers)).toContain(SELF);
  expect(policyOf(response.headers).replace('https://avatars.githubusercontent.com', '')).not.toContain('github.com');
});

test('the policy of the setup pages is the default one with that single directive changed, on http and on https', () => {
  const http = setupPagePolicy({ publicBaseUrl: 'http://localhost:3000' });
  const https = setupPagePolicy({ publicBaseUrl: 'https://cla.example.org' });
  expect(http.split(';')).toEqual([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' https://avatars.githubusercontent.com",
    "base-uri 'self'",
    "form-action 'self' https://github.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ]);
  expect(https).toBe(`${http};upgrade-insecure-requests`);
});
