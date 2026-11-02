// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import crypto from 'node:crypto';
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import {
  AUTH_ENV,
  TEST_CLIENT_ID,
  TEST_CLIENT_SECRET,
  TEST_SESSION_SECRET,
} from '../../config/auth-fixture/test-support.ts';
import { testApp } from '../../test-support.ts';
import { authWorld, COOKIE_NAME } from './auth-fixture/test-support.ts';
import { OAUTH_COOKIE_ATTRIBUTES, OAUTH_COOKIE_NAME, sentAttempt } from './login-fixture/test-support.ts';

// GET /api/auth/login (E10-S04): the start of the login. The cookie that carries the attempt, the redirect to GitHub, and
// the path the person ends at are all decided here, and none of it touches the database.

const BASE = 'https://app.example.com';
const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;
const world = () => authWorld({ PUBLIC_BASE_URL: BASE });

/** The hostile `return_to` values of the story, plus the ones that came up while building the rule. */
const HOSTILE = [
  '//evil.example',
  '/\\evil.example',
  '\\\\evil.example',
  'https://evil.example',
  'javascript:alert(1)',
  '/\t/evil.example',
  '/%0d%0aSet-Cookie:x',
  '/..//evil.example',
  `/${'a'.repeat(512)}`,
  '',
  '/%2F/evil.example',
];

test('it redirects 302 to GitHub with exactly client_id, redirect_uri, state, code_challenge and code_challenge_method, and no scope', async () => {
  const { app } = await world();
  const response = await app.inject('/api/auth/login');
  expect(response.statusCode).toBe(302);
  const location = new URL(String(response.headers.location));
  expect(`${location.origin}${location.pathname}`).toBe('https://github.com/login/oauth/authorize');
  expect([...location.searchParams.keys()]).toEqual([
    'client_id',
    'redirect_uri',
    'state',
    'code_challenge',
    'code_challenge_method',
  ]);
  expect(location.searchParams.get('client_id')).toBe(TEST_CLIENT_ID);
  expect(location.searchParams.get('redirect_uri')).toBe(`${BASE}/api/auth/callback`);
  expect(location.searchParams.get('code_challenge_method')).toBe('S256');
  expect(location.searchParams.has('scope')).toBe(false);
  expect(response.body).not.toContain(TEST_CLIENT_SECRET);
});

test('the state is the one in the cookie and the challenge is base64url(sha256(verifier)); the verifier never leaves the cookie', async () => {
  const { app } = await world();
  const response = await app.inject('/api/auth/login');
  const location = new URL(String(response.headers.location));
  const { attempt } = sentAttempt(response.headers['set-cookie']);
  expect(attempt.s).toMatch(BASE64URL_43);
  expect(attempt.v).toMatch(BASE64URL_43);
  expect(attempt.s).not.toBe(attempt.v);
  expect(location.searchParams.get('state')).toBe(attempt.s);
  expect(location.searchParams.get('code_challenge')).toBe(
    crypto.createHash('sha256').update(attempt.v).digest('base64url'),
  );
  expect(response.headers.location).not.toContain(attempt.v);
  expect(response.body).not.toContain(attempt.v);
});

test('the cookie is __Host-cla_oauth, HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age=600, no Domain, signed with the session secret', async () => {
  const { app } = await world();
  const response = await app.inject('/api/auth/login');
  const sent = sentAttempt(response.headers['set-cookie']);
  expect(sent.header.startsWith(`${OAUTH_COOKIE_NAME}=`)).toBe(true);
  expect(sent.header.endsWith(`; ${OAUTH_COOKIE_ATTRIBUTES}`)).toBe(true);
  expect(sent.header).not.toMatch(/domain/i);
  expect(sent.signedBySessionSecret).toBe(true);
  expect(app.unsignCookie(decodeURIComponent(sent.cookie.slice(OAUTH_COOKIE_NAME.length + 1))).valid).toBe(true);
  expect(Object.keys(sent.attempt)).toEqual(['s', 'v', 'r', 't']);
  expect(sent.attempt.t).toBe(Date.parse('2026-11-02T10:00:00.000Z'));
});

test.each([
  ['no return_to', '', '/'],
  ['an empty return_to', '?return_to=', '/'],
  ['a page', '?return_to=%2Fdashboard', '/dashboard'],
  ['a sign link with a query string', `?return_to=${encodeURIComponent('/sign/123?pr=45')}`, '/sign/123?pr=45'],
  ['return_to given twice', '?return_to=%2Fa&return_to=%2Fb', '/'],
  ['return_to as a bracketed key', '?return_to[]=%2Fa', '/'],
  ['an unknown parameter next to a good one', '?x=1&return_to=%2Fdashboard', '/dashboard'],
])('%s: the cookie keeps %s as the checked return path', async (_label, query, expected) => {
  const { app } = await world();
  const response = await app.inject(`/api/auth/login${query}`);
  expect(response.statusCode).toBe(302);
  expect(sentAttempt(response.headers['set-cookie']).attempt.r).toBe(expected);
});

test('open redirect: every hostile return_to ends at the front page, in the cookie and in the redirect of a stranger', async () => {
  const { app } = await world();
  const seen: { value: string; status: number; path: string; origin: string }[] = [];
  for (const value of HOSTILE) {
    const response = await app.inject({ url: '/api/auth/login', query: { return_to: value } });
    seen.push({
      value,
      status: response.statusCode,
      path: sentAttempt(response.headers['set-cookie']).attempt.r,
      origin: new URL(String(response.headers.location)).origin,
    });
  }
  expect(seen).toEqual(HOSTILE.map((value) => ({ value, status: 302, path: '/', origin: 'https://github.com' })));
});

test('open redirect: every hostile return_to sends a logged-in person to the front page of this site', async () => {
  const { app, login } = await world();
  const alice = await login(1001);
  const seen: { value: string; status: number; location: string | undefined }[] = [];
  for (const value of HOSTILE) {
    const response = await app.inject({
      url: '/api/auth/login',
      query: { return_to: value },
      headers: { cookie: alice.cookie },
    });
    seen.push({ value, status: response.statusCode, location: response.headers.location });
  }
  expect(seen).toEqual(HOSTILE.map((value) => ({ value, status: 302, location: '/' })));
});

test('a return_to with characters outside ASCII is percent-encoded, so the redirect header stays valid instead of failing', async () => {
  const { app, login } = await world();
  const alice = await login(1001);
  const stranger = await app.inject({ url: '/api/auth/login', query: { return_to: '/caf\u00e9/\u4e2d' } });
  expect(sentAttempt(stranger.headers['set-cookie']).attempt.r).toBe('/caf%C3%A9/%E4%B8%AD');
  const member = await app.inject({
    url: '/api/auth/login',
    query: { return_to: '/caf\u00e9/\u4e2d' },
    headers: { cookie: alice.cookie },
  });
  expect(member.statusCode).toBe(302);
  expect(member.headers.location).toBe('/caf%C3%A9/%E4%B8%AD');
});

test.each([
  ['511 CJK characters, which resolve to a path of 4599', `/${'中'.repeat(511)}`, '/'],
  ['an accented path that resolves to 513 characters', `/${'é'.repeat(85)}aa`, '/'],
  ['the longest path that is kept, in the characters the cookie encodes three-fold', `/a${'/'.repeat(510)}`, undefined],
])('a return_to of %s never makes the attempt cookie too big for a browser', async (_label, value, expected) => {
  const { app } = await world();
  const response = await app.inject({ url: '/api/auth/login', query: { return_to: value } });
  expect(response.statusCode).toBe(302);
  const sent = sentAttempt(response.headers['set-cookie']);
  expect(sent.attempt.r).toBe(expected ?? value);
  expect(sent.header.length).toBeLessThan(4096);
});

test('a second login start overwrites the first: same cookie name, a new state, so the earlier tab ends in a mismatch', async () => {
  const { app } = await world();
  const first = await app.inject('/api/auth/login?return_to=%2Fone');
  const second = await app.inject('/api/auth/login?return_to=%2Ftwo');
  const a = sentAttempt(first.headers['set-cookie']);
  const b = sentAttempt(second.headers['set-cookie']);
  expect(a.cookie.split('=')[0]).toBe(b.cookie.split('=')[0]);
  expect(a.attempt.s).not.toBe(b.attempt.s);
  expect(a.attempt.v).not.toBe(b.attempt.v);
  expect(new URL(String(first.headers.location)).searchParams.get('state')).toBe(a.attempt.s);
  expect(new URL(String(second.headers.location)).searchParams.get('state')).toBe(b.attempt.s);
  expect([a.attempt.r, b.attempt.r]).toEqual(['/one', '/two']);
});

test('fifty calls produce fifty distinct state values', async () => {
  const { app } = await world();
  // Fifty clients, one start each: the budget of a start is 20 a minute for one client address (E10-S08).
  const responses = await Promise.all(
    Array.from({ length: 50 }, (_unused, n) =>
      app.inject({ url: '/api/auth/login', remoteAddress: `198.51.100.${n + 1}` }),
    ),
  );
  const states = responses.map((response) => new URL(String(response.headers.location)).searchParams.get('state'));
  expect(new Set(states).size).toBe(50);
  const verifiers = responses.map((response) => sentAttempt(response.headers['set-cookie']).attempt.v);
  expect(new Set(verifiers).size).toBe(50);
});

test('a logged-in person goes straight to the checked path: no cookie, no GitHub, and only the session lookup is queried', async () => {
  const { app, login, queries } = await world();
  const alice = await login(1001);
  const response = await app.inject({
    url: '/api/auth/login?return_to=%2Fsign%2F123%3Fpr%3D45',
    headers: { cookie: alice.cookie },
  });
  expect(response.statusCode).toBe(302);
  expect(response.headers.location).toBe('/sign/123?pr=45');
  expect(response.headers['set-cookie']).toBeUndefined();
  expect(queries).toEqual(['SelectQueryNode']);
});

test('a logged-in person without return_to goes to the front page', async () => {
  const { app, login } = await world();
  const alice = await login(1001);
  const response = await app.inject({ url: '/api/auth/login', headers: { cookie: alice.cookie } });
  expect(response.headers.location).toBe('/');
});

test('the route performs no database query at all for a person who is not logged in', async () => {
  const { app, db, queries } = await world();
  await app.inject('/api/auth/login?return_to=%2Fdashboard');
  expect(queries).toEqual([]);
  expect(await db.selectFrom('sessions').selectAll().execute()).toEqual([]);
  expect(await db.selectFrom('users').selectAll().execute()).toEqual([]);
});

test('a session cookie of the right shape for a session that does not exist is a stranger: GitHub, and a shape check only', async () => {
  const { app, queries } = await world();
  const response = await app.inject({
    url: '/api/auth/login?return_to=%2Fdashboard',
    headers: { cookie: `${COOKIE_NAME}=${'B'.repeat(43)}` },
  });
  expect(new URL(String(response.headers.location)).origin).toBe('https://github.com');
  expect(sentAttempt(response.headers['set-cookie']).attempt.r).toBe('/dashboard');
  expect(queries).toEqual(['SelectQueryNode']);
});

test('an expired session is a stranger too: the login goes to GitHub, not to the checked path', async () => {
  const { app, advance, login } = await world();
  const alice = await login(1001);
  advance(8 * 3600);
  const response = await app.inject({ url: '/api/auth/login', headers: { cookie: alice.cookie } });
  expect(new URL(String(response.headers.location)).origin).toBe('https://github.com');
});

test('both answers carry Cache-Control: no-store', async () => {
  const { app, login } = await world();
  const alice = await login(1001);
  const stranger = await app.inject('/api/auth/login');
  const member = await app.inject({ url: '/api/auth/login', headers: { cookie: alice.cookie } });
  expect([stranger, member].map((response) => response.headers['cache-control'])).toEqual(['no-store', 'no-store']);
});

test('the log holds neither the state, the verifier, the challenge, the return path nor a secret', async () => {
  const { app, logs } = await world();
  const response = await app.inject('/api/auth/login?return_to=%2Fsecret-page%3Ftoken%3Dabc');
  const location = new URL(String(response.headers.location));
  const { attempt } = sentAttempt(response.headers['set-cookie']);
  const text = logs.text();
  expect(text).toContain('/api/auth/login');
  for (const hidden of [
    attempt.s,
    attempt.v,
    location.searchParams.get('code_challenge') ?? 'missing',
    'secret-page',
    'token=abc',
    TEST_CLIENT_SECRET,
    TEST_SESSION_SECRET,
  ]) {
    expect(text).not.toContain(hidden);
  }
});

test.each(['POST', 'PUT', 'DELETE'] as const)('%s on the login path is a 404 and sets no cookie', async (method) => {
  const { app, origin } = await world();
  const response = await app.inject({ method, url: '/api/auth/login', headers: { origin } });
  expect(response.statusCode).toBe(404);
  expect(response.headers['set-cookie']).toBeUndefined();
});

test.each([
  ['no login setting at all', {}],
  ['no client secret', { ...AUTH_ENV, GITHUB_CLIENT_SECRET: '' }],
])('with %s there is no login route', async (_label, env) => {
  const { app } = await testApp({ env });
  const response = await app.inject('/api/auth/login?return_to=%2Fdashboard');
  expect(response.statusCode).toBe(404);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('not_found');
  expect(response.headers['set-cookie']).toBeUndefined();
});
