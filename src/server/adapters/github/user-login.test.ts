// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { Secret } from '../../config/secret.ts';
import { LoginFailure } from '../../services/ports/github-login.ts';
import { createGithubLogin } from './user-login.ts';
import { type GithubLoginOptions, LOGIN_TIMEOUT_MS } from './user-login-transport.ts';

// The login's GitHub calls (E10-S05) against a scripted `fetch`: the shape of what is sent, which the callback tests see
// only through a mocked GitHub, and the failures of the transport itself.

const TOKEN = new Secret('ghu_made-up-token');

interface Sent {
  readonly url: string;
  readonly init: RequestInit;
}

/** A `fetch` that records what it is asked and answers each call with the next of `answers`. */
function scripted(...answers: (Response | Error)[]) {
  const sent: Sent[] = [];
  const send: typeof fetch = (input, init) => {
    sent.push({ url: new Request(input).url, init: init ?? {} });
    const answer = answers.shift() ?? new Response('{}');
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  return { sent, send };
}

function loginOver(send: typeof fetch | undefined, overrides: Partial<GithubLoginOptions> = {}) {
  return createGithubLogin({
    clientId: 'Iv1.made-up',
    clientSecret: new Secret('made-up-secret'),
    redirectUri: 'https://app.example.com/api/auth/callback',
    timeoutMs: LOGIN_TIMEOUT_MS,
    fetch: send,
    ...overrides,
  });
}

const failureOf = (work: Promise<unknown>): Promise<unknown> => work.catch((error: unknown) => error);

test('the ceiling of every call is ten seconds', () => {
  expect(LOGIN_TIMEOUT_MS).toBe(10_000);
});

test('every call refuses redirects and carries a timeout, so a token never follows a redirect and a hang ends', async () => {
  const { sent, send } = scripted(
    Response.json({ access_token: 'ghu_made-up-token' }),
    Response.json({ id: 1, login: 'a', type: 'User' }),
    Response.json([]),
    new Response(null, { status: 204 }),
  );
  const github = loginOver(send);
  await github.exchange('code', 'verifier');
  await github.identity(TOKEN);
  await github.revoke(TOKEN);
  expect(sent.map((call) => call.init.method)).toEqual(['POST', 'GET', 'GET', 'DELETE']);
  expect(sent.map((call) => call.init.redirect)).toEqual(['error', 'error', 'error', 'error']);
  for (const call of sent) {
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
  }
});

test('the client id is a path segment: it is escaped, so it cannot change the route', async () => {
  const { sent, send } = scripted(new Response(null, { status: 204 }));
  await loginOver(send, { clientId: 'a/b c?d' }).revoke(TOKEN);
  expect(sent[0]?.url).toBe('https://api.github.com/applications/a%2Fb%20c%3Fd/token');
});

test('the token goes into the Authorization header of the identity calls and nowhere in a URL', async () => {
  const { sent, send } = scripted(Response.json({ id: 1, login: 'a', type: 'User' }), Response.json([]));
  await loginOver(send).identity(TOKEN);
  expect(sent.map((call) => call.url)).toEqual([
    'https://api.github.com/user',
    'https://api.github.com/user/emails?per_page=100',
  ]);
  for (const call of sent) {
    expect(call.url).not.toContain('ghu_');
    expect(new Headers(call.init.headers).get('authorization')).toBe('Bearer ghu_made-up-token');
  }
});

test('the exchange returns the access token as a Secret and drops the refresh token and the expiries', async () => {
  const answer = Response.json({
    access_token: 'ghu_made-up-token',
    token_type: 'bearer',
    scope: '',
    expires_in: 28800,
    refresh_token: 'ghr_made-up-refresh',
    refresh_token_expires_in: 15811200,
  });
  const token = await loginOver(scripted(answer).send).exchange('code', 'verifier');
  expect(token).toBeInstanceOf(Secret);
  expect(token.reveal()).toBe('ghu_made-up-token');
  expect(JSON.stringify(token)).not.toContain('ghu_');
});

test('without a fetch of its own the adapter uses the global one, read when a call is made', async () => {
  const github = loginOver(undefined);
  const { sent, send } = scripted(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', send);
  try {
    expect(await github.revoke(TOKEN)).toEqual({ ok: true });
  } finally {
    vi.unstubAllGlobals();
  }
  expect(sent).toHaveLength(1);
});

test('a transport error is an outage with a fixed message: the error that caused it is not kept', async () => {
  const failure = await failureOf(
    loginOver(scripted(new TypeError('fetch failed: ghu_made-up-token')).send).exchange('c', 'v'),
  );
  expect(failure).toBeInstanceOf(LoginFailure);
  expect(failure).toHaveProperty('reason', 'github_unavailable');
  expect(failure).toHaveProperty('message', 'The login failed (github_unavailable)');
  expect(failure).not.toHaveProperty('cause');
});

test('a body that breaks off while it is read is an outage, not a bad request', async () => {
  const broken = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new Error('connection reset'));
      },
    }),
  );
  const failure = await failureOf(loginOver(scripted(broken).send).exchange('c', 'v'));
  expect(failure).toHaveProperty('reason', 'github_unavailable');
});

test.each([
  ['an answer that is not JSON', new Response('<html>')],
  ['an answer of the wrong shape', Response.json({ unexpected: true })],
])('%s to the exchange is a bad request', async (_label, answer) => {
  const failure = await failureOf(loginOver(scripted(answer).send).exchange('c', 'v'));
  expect(failure).toHaveProperty('reason', 'bad_request');
});

test.each([
  ['a status', new Response('{}', { status: 404 }), { ok: false, status: 404 }],
  ['a transport error', new TypeError('down'), { ok: false, status: null }],
  ['success', new Response(null, { status: 204 }), { ok: true }],
  ['a 200 that is not the 204 GitHub sends', new Response('{}', { status: 200 }), { ok: false, status: 200 }],
])('the revocation meets %s and reports %j without throwing', async (_label, answer, expected) => {
  expect(await loginOver(scripted(answer).send).revoke(TOKEN)).toEqual(expected);
});
