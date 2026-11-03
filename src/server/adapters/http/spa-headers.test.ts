// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { SCRIPT_URL, webApp } from './spa-fixture/test-support.ts';

// E17-S03: what every response that carries the app has in its headers, and what none of them has.

const POLICY =
  "default-src 'self';script-src 'self';style-src 'self';img-src 'self' https://avatars.githubusercontent.com;base-uri 'self';form-action 'self';frame-ancestors 'none';object-src 'none'";
const HTML = { accept: 'text/html' };

test.each([
  ['the root', { url: '/' }],
  ['index.html by name', { url: '/index.html' }],
  ['a route of the app', { url: '/signatures', headers: HTML }],
  ['a HEAD of the root', { method: 'HEAD', url: '/' }],
  ['a HEAD of a route of the app', { method: 'HEAD', url: '/signatures', headers: HTML }],
  ['a revalidation of the root', { url: '/', headers: { 'if-none-match': '*' } }],
  ['a hashed script', { url: SCRIPT_URL }],
  ['the theme script of the page', { url: '/theme-init.js' }],
] as const)('%s carries the policy, nosniff and no referrer', async (_what, request) => {
  const { app } = await webApp();
  const { headers } = await app.inject(request);
  expect(headers['content-security-policy']).toBe(POLICY);
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-request-id']).toBeDefined();
});

test('the policy lets images come from our origin and GitHub avatars and nothing else, and needs no font host', async () => {
  const { app } = await webApp();
  const policy = String((await app.inject('/')).headers['content-security-policy']);
  const directives = new Map(policy.split(';').map((part) => [part.split(' ')[0], part.split(' ').slice(1)] as const));
  expect(directives.get('img-src')).toEqual(["'self'", 'https://avatars.githubusercontent.com']);
  expect(directives.has('font-src')).toBe(false);
  expect(directives.get('default-src')).toEqual(["'self'"]);
  expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|data:|blob:|\*/);
  expect([...directives.keys()]).toEqual([
    'default-src',
    'script-src',
    'style-src',
    'img-src',
    'base-uri',
    'form-action',
    'frame-ancestors',
    'object-src',
  ]);
});

test('behind an https public URL the policy upgrades insecure requests and the page is told to stay on https', async () => {
  const { app } = await webApp({ PUBLIC_BASE_URL: 'https://cla.example.org' });
  const { headers } = await app.inject('/');
  expect(headers['content-security-policy']).toBe(`${POLICY};upgrade-insecure-requests`);
  expect(headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains');
});

// No CORS plugin is registered, so the browser's same-origin policy is all that stands between another site and the answer.
test.each([
  ['the app', { url: '/' }],
  ['a hashed script', { url: SCRIPT_URL }],
  ['a route of the app', { url: '/signatures', headers: HTML }],
  ['a probe', { url: '/healthz' }],
  ['a 404', { url: '/api/nope' }],
  ['a preflight', { method: 'OPTIONS', url: '/', headers: { 'access-control-request-method': 'GET' } }],
  [
    'a preflight of the API',
    { method: 'OPTIONS', url: '/api/auth/session', headers: { 'access-control-request-method': 'GET' } },
  ],
] as const)('a request from https://evil.example for %s gets no CORS header', async (_what, request) => {
  const { app } = await webApp();
  const { headers } = await app.inject({
    ...request,
    headers: { ...('headers' in request ? request.headers : {}), origin: 'https://evil.example' },
  });
  expect(Object.keys(headers).filter((name) => name.startsWith('access-control-'))).toEqual([]);
  expect(String(headers.vary)).not.toMatch(/origin/i);
});
