// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import crypto from 'node:crypto';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { AUTH_ENV, TEST_CLIENT_ID, TEST_CLIENT_SECRET } from '../../config/auth-fixture/test-support.ts';
import { testApp } from '../../test-support.ts';
import { callbackWorld, fakeGithub, setCookies } from './callback-fixture/test-support.ts';

// The mocked GitHub of the callback tests (E10-S05) is only worth something if it refuses what the real one refuses. These tests
// pin its behaviour, so a callback test that passes because the fake was lenient cannot slip through.

const REDIRECT = 'https://app.example.com/api/auth/callback';
const VERIFIER = 'v'.repeat(43);
const CHALLENGE = crypto.createHash('sha256').update(VERIFIER).digest('base64url');
const AUTHORIZE = `https://github.com/login/oauth/authorize?${new URLSearchParams({
  client_id: TEST_CLIENT_ID,
  redirect_uri: REDIRECT,
  code_challenge: CHALLENGE,
  code_challenge_method: 'S256',
}).toString()}`;

/** The JSON of an answer, read as far as the test needs. */
const fields = async (response: Response | Promise<Response>) =>
  z
    .looseObject({ error: z.string().optional(), access_token: z.string().optional(), id: z.number().optional() })
    .parse(await (await response).json());

/** What the exchange is sent, each field replaceable. */
function exchange(code: string, change: Record<string, string> = {}): Promise<Response> {
  const form = new URLSearchParams({
    client_id: TEST_CLIENT_ID,
    client_secret: TEST_CLIENT_SECRET,
    code,
    redirect_uri: REDIRECT,
    code_verifier: VERIFIER,
    ...change,
  });
  return fetch('https://github.com/login/oauth/access_token', { method: 'POST', body: form });
}

const errorOf = async (response: Promise<Response>): Promise<string | undefined> => (await fields(response)).error;

test('a granted code is exchanged once, for a token that identifies the account', async () => {
  const github = fakeGithub();
  const code = github.grant(AUTHORIZE);
  const answer = await exchange(code);
  expect(answer.status).toBe(200);
  const token = String((await fields(answer)).access_token);
  const user = await fetch('https://api.github.com/user', { headers: { authorization: `Bearer ${token}` } });
  expect((await fields(user)).id).toBe(1001);
  expect(await errorOf(exchange(code))).toBe('bad_verification_code');
});

test.each([
  ['an unknown code', 'never-granted', {}, 'bad_verification_code'],
  ['a wrong client secret', undefined, { client_secret: 'wrong' }, 'incorrect_client_credentials'],
  ['a wrong client id', undefined, { client_id: 'wrong' }, 'incorrect_client_credentials'],
  ['another redirect URI', undefined, { redirect_uri: 'https://evil.example/cb' }, 'redirect_uri_mismatch'],
  ['another verifier', undefined, { code_verifier: 'w'.repeat(43) }, 'bad_verification_code'],
])('the exchange with %s is refused with an error in a 200 answer', async (_label, code, change, error) => {
  const github = fakeGithub();
  const granted = github.grant(AUTHORIZE);
  expect(await errorOf(exchange(code ?? granted, change))).toBe(error);
  expect(github.issued).toEqual([]);
});

test('a grant made for another client cannot be exchanged', async () => {
  const github = fakeGithub();
  const code = github.grant(AUTHORIZE.replace(TEST_CLIENT_ID, 'Iv1.someone-else'));
  expect(await errorOf(exchange(code))).toBe('redirect_uri_mismatch');
});

test.each([
  ['an unknown token', 'Bearer nobody'],
  ['no credentials', ''],
])('the identity routes answer 401 to %s', async (_label, authorization) => {
  fakeGithub();
  for (const path of ['/user', '/user/emails']) {
    const response = await fetch(`https://api.github.com${path}`, { headers: { authorization } });
    expect(response.status).toBe(401);
  }
});

test('a revoked token stops working, and only Basic authentication with the client credentials revokes', async () => {
  const github = fakeGithub();
  const token = String((await fields(exchange(github.grant(AUTHORIZE)))).access_token);
  const url = `https://api.github.com/applications/${TEST_CLIENT_ID}/token`;
  const body = JSON.stringify({ access_token: token });
  const refused = await fetch(url, { method: 'DELETE', body, headers: { authorization: 'Basic d3Jvbmc6d3Jvbmc=' } });
  expect(refused.status).toBe(401);
  expect(github.revoked).toEqual([]);
  const basic = Buffer.from(`${TEST_CLIENT_ID}:${TEST_CLIENT_SECRET}`).toString('base64');
  const revoked = await fetch(url, { method: 'DELETE', body, headers: { authorization: `Basic ${basic}` } });
  expect(revoked.status).toBe(204);
  expect(github.revoked).toEqual([token]);
  const after = await fetch('https://api.github.com/user', { headers: { authorization: `Bearer ${token}` } });
  expect(after.status).toBe(401);
});

test('the account the next grant signs in as can be changed, and a grant keeps the account it was made for', async () => {
  const github = fakeGithub();
  const first = github.grant(AUTHORIZE);
  github.account = { ...github.account, id: 2002, login: 'bob' };
  expect(github.account.login).toBe('bob');
  const second = github.grant(AUTHORIZE);
  const ids: unknown[] = [];
  for (const code of [first, second]) {
    const token = String((await fields(exchange(code))).access_token);
    const user = await fetch('https://api.github.com/user', { headers: { authorization: `Bearer ${token}` } });
    ids.push((await fields(user)).id);
  }
  expect(ids).toEqual([1001, 2002]);
});

test('a response without Set-Cookie has no cookies', async () => {
  const world = await callbackWorld();
  const response = await world.app.inject('/healthz');
  expect(setCookies(response)).toEqual([]);
});

test('the app uses the fetch it is given for the login', async () => {
  const called: string[] = [];
  const stub: typeof fetch = (input) => {
    called.push(new Request(input).url);
    return Promise.resolve(new Response('{}', { status: 500 }));
  };
  const { app } = await testApp({ env: AUTH_ENV, fetch: stub });
  const login = await app.inject('/api/auth/login');
  const cookie = String(login.headers['set-cookie']).split(';')[0] ?? '';
  const state = new URL(String(login.headers.location)).searchParams.get('state');
  const callback = await app.inject({ url: `/api/auth/callback?code=c&state=${state}`, headers: { cookie } });
  expect(callback.headers.location).toBe('/login/failed?reason=github_unavailable');
  expect(called).toEqual(['https://github.com/login/oauth/access_token']);
});
