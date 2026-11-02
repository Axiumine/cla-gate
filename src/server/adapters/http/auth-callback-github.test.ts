// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { delay, HttpResponse, type JsonBodyType } from 'msw';
import { expect, test } from 'vitest';
import {
  ALICE,
  callbackWorld,
  type FakeAccount,
  type FakeGithub,
  setCookies,
} from './callback-fixture/test-support.ts';
import { OAUTH_COOKIE_NAME } from './login-fixture/test-support.ts';

// GET /api/auth/callback (E10-S05), the part where GitHub does not cooperate: every way the exchange, the identity and the
// addresses can go wrong ends at a closed reason, writes nothing, and leaves the token revoked when one was issued.

const OAUTH_CLEARED = `${OAUTH_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;

const json =
  (body: JsonBodyType, status = 200): (() => Response) =>
  () =>
    HttpResponse.json(body, { status });
const text =
  (body: string, status = 200): (() => Response) =>
  () =>
    new HttpResponse(body, { status });
const status = (code: number): (() => Response) => json({ message: 'made up' }, code);
const network = (): Response => HttpResponse.error();
const redirect = (): Response =>
  new HttpResponse(null, { status: 302, headers: { location: 'https://evil.example/x' } });
const stalled = async (): Promise<Response> => {
  await delay('infinite');
  return HttpResponse.json({});
};

/** A `GET /user` answer for a user whose fields are changed by `change`. */
const userWith =
  (change: Record<string, unknown>): (() => Response) =>
  () =>
    HttpResponse.json({
      id: ALICE.id,
      login: ALICE.login,
      type: 'User',
      name: ALICE.name,
      avatar_url: ALICE.avatarUrl,
      ...change,
    });

type Setup = (github: FakeGithub) => void;

const exchange =
  (answer: () => Response | Promise<Response>): Setup =>
  (github) => {
    github.answer.token = answer;
  };
const user =
  (answer: () => Response | Promise<Response>): Setup =>
  (github) => {
    github.answer.user = answer;
  };
const emails =
  (answer: () => Response | Promise<Response>): Setup =>
  (github) => {
    github.answer.emails = answer;
  };

const TIMEOUT_MS = 60;

/** Every way the token endpoint can fail, and what the person is told. */
const EXCHANGE_FAILURES: [string, Setup, string][] = [
  ['an error in a 200 answer', exchange(json({ error: 'bad_verification_code' })), 'exchange_failed'],
  [
    'an error next to an access token in a 200 answer',
    exchange(json({ error: 'incorrect_client_credentials', access_token: 'ghu_made-up-x' })),
    'exchange_failed',
  ],
  ['a 400', exchange(status(400)), 'exchange_failed'],
  ['a 401', exchange(status(401)), 'exchange_failed'],
  ['a 404', exchange(status(404)), 'exchange_failed'],
  ['a 429', exchange(status(429)), 'github_unavailable'],
  ['a 500', exchange(status(500)), 'github_unavailable'],
  ['a 503', exchange(status(503)), 'github_unavailable'],
  ['a connection that breaks', exchange(network), 'github_unavailable'],
  ['an answer that never comes', exchange(stalled), 'github_unavailable'],
  ['a redirect, which is not followed', exchange(redirect), 'github_unavailable'],
  ['an answer that is not JSON', exchange(text('<html>nope</html>')), 'bad_request'],
  ['an answer that is not an object', exchange(json(['ghu_made-up-x'])), 'bad_request'],
  ['an answer without an access token', exchange(json({ token_type: 'bearer' })), 'bad_request'],
  ['an empty access token', exchange(json({ access_token: '' })), 'bad_request'],
  ['an access token with a space', exchange(json({ access_token: 'ghu made-up' })), 'bad_request'],
  ['an access token with a line break', exchange(json({ access_token: 'ghu_made-up\r\nx: y' })), 'bad_request'],
  ['an access token of the wrong type', exchange(json({ access_token: 12345 })), 'bad_request'],
  ['an expiry of the wrong type', exchange(json({ access_token: 'ghu_made-up-x', expires_in: 'soon' })), 'bad_request'],
];

test.each(EXCHANGE_FAILURES)('the exchange meets %s: the login fails with %s', async (_label, setup, reason) => {
  const world = await callbackWorld({}, { githubTimeoutMs: TIMEOUT_MS });
  setup(world.github);
  const { response } = await world.signIn();
  expect(response.statusCode).toBe(302);
  expect(response.headers.location).toBe(`/login/failed?reason=${reason}`);
  expect(setCookies(response)).toEqual([OAUTH_CLEARED]);
  expect(world.github.requests.map((request) => request.method)).toEqual(['POST']);
  expect(await world.db.selectFrom('users').select('id').execute()).toEqual([]);
  expect(await world.db.selectFrom('sessions').select('id').execute()).toEqual([]);
});

/** Every way `GET /user` can fail. */
const USER_FAILURES: [string, Setup, string][] = [
  ['a 401', user(status(401)), 'exchange_failed'],
  ['a 403', user(status(403)), 'exchange_failed'],
  ['a 404', user(status(404)), 'exchange_failed'],
  ['a 500', user(status(500)), 'github_unavailable'],
  ['a connection that breaks', user(network), 'github_unavailable'],
  ['an answer that never comes', user(stalled), 'github_unavailable'],
  ['a redirect, which is not followed', user(redirect), 'github_unavailable'],
  ['an answer that is not JSON', user(text('nope')), 'bad_request'],
  ['an answer that is null', user(json(null)), 'bad_request'],
  ['an answer that is a list', user(json([ALICE])), 'bad_request'],
  ['an answer without a type', user(userWith({ type: undefined })), 'bad_request'],
  ['a bot', user(userWith({ type: 'Bot', login: 'dependabot[bot]' })), 'unsupported_account'],
  ['an organisation', user(userWith({ type: 'Organization' })), 'unsupported_account'],
  ['a mannequin', user(userWith({ type: 'Mannequin' })), 'unsupported_account'],
  ['the type in other case', user(userWith({ type: 'user' })), 'unsupported_account'],
  ['an id that is text', user(userWith({ id: '1001' })), 'bad_request'],
  ['an id of zero', user(userWith({ id: 0 })), 'bad_request'],
  ['a negative id', user(userWith({ id: -5 })), 'bad_request'],
  ['an id with a fraction', user(userWith({ id: 1.5 })), 'bad_request'],
  [
    'an id beyond the safe integers',
    user(text('{"id":9007199254740993,"login":"alice","type":"User"}')),
    'bad_request',
  ],
  ['no id', user(userWith({ id: undefined })), 'bad_request'],
  ['an empty login', user(userWith({ login: '' })), 'bad_request'],
  ['a login with a space', user(userWith({ login: 'octo cat' })), 'bad_request'],
  ['a login with an underscore', user(userWith({ login: 'octo_cat' })), 'bad_request'],
  ['a login that starts with a hyphen', user(userWith({ login: '-octocat' })), 'bad_request'],
  ['a login of 40 characters', user(userWith({ login: 'a'.repeat(40) })), 'bad_request'],
  ['a login with markup', user(userWith({ login: '<script>alert(1)</script>' })), 'bad_request'],
  ['a login with a line break at the end', user(userWith({ login: 'alice\n' })), 'bad_request'],
  ['a bot login on a user', user(userWith({ login: 'dependabot[bot]' })), 'bad_request'],
  ['no login', user(userWith({ login: undefined })), 'bad_request'],
  ['a name that is a number', user(userWith({ name: 42 })), 'bad_request'],
  ['a name with a NUL character', user(userWith({ name: 'Ali\u0000ce' })), 'bad_request'],
  ['an avatar that is a number', user(userWith({ avatar_url: 42 })), 'bad_request'],
];

test.each(USER_FAILURES)(
  'GET /user meets %s: the login fails with %s, no row is written, the token is revoked',
  async (_label, setup, reason) => {
    const world = await callbackWorld({}, { githubTimeoutMs: TIMEOUT_MS });
    setup(world.github);
    const { response } = await world.signIn();
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`/login/failed?reason=${reason}`);
    expect(setCookies(response)).toEqual([OAUTH_CLEARED]);
    expect(await world.db.selectFrom('users').select('id').execute()).toEqual([]);
    expect(await world.db.selectFrom('sessions').select('id').execute()).toEqual([]);
    expect(world.github.issued).toHaveLength(1);
    expect(world.github.revoked).toEqual(world.github.issued);
  },
);

test.each([
  ['a bot', 'Bot'],
  ['an organisation', 'Organization'],
])('%s is refused before the addresses are read', async (_label, type) => {
  const world = await callbackWorld();
  world.github.account = { ...ALICE, type };
  const { response } = await world.signIn();
  expect(response.headers.location).toBe('/login/failed?reason=unsupported_account');
  expect(world.github.requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
    'POST /login/oauth/access_token',
    'GET /user',
    expect.stringMatching(/^DELETE \/applications\//),
  ]);
});

/** Every way `GET /user/emails` can fail. */
const EMAIL_FAILURES: [string, Setup, string][] = [
  ['a 401', emails(status(401)), 'exchange_failed'],
  ['a 403 (the App lacks the permission)', emails(status(403)), 'exchange_failed'],
  ['a 404', emails(status(404)), 'exchange_failed'],
  ['a 500', emails(status(500)), 'github_unavailable'],
  ['a connection that breaks', emails(network), 'github_unavailable'],
  ['an answer that never comes', emails(stalled), 'github_unavailable'],
  ['an answer that is not JSON', emails(text('nope')), 'bad_request'],
  ['an answer that is an object', emails(json({ email: 'a@example.org' })), 'bad_request'],
  ['an entry without the verified flag', emails(json([{ email: 'a@example.org', primary: true }])), 'bad_request'],
  ['an entry with an empty address', emails(json([{ email: '', primary: true, verified: true }])), 'bad_request'],
  [
    'an address of 321 characters',
    emails(json([{ email: `${'a'.repeat(309)}@example.org`, primary: true, verified: true }])),
    'bad_request',
  ],
  ['a flag that is text', emails(json([{ email: 'a@example.org', primary: 'yes', verified: true }])), 'bad_request'],
];

test.each(EMAIL_FAILURES)(
  'GET /user/emails meets %s: the login fails with %s, no row is written, the token is revoked',
  async (_label, setup, reason) => {
    const world = await callbackWorld({}, { githubTimeoutMs: TIMEOUT_MS });
    setup(world.github);
    const { response } = await world.signIn();
    expect(response.headers.location).toBe(`/login/failed?reason=${reason}`);
    expect(setCookies(response)).toEqual([OAUTH_CLEARED]);
    expect(await world.db.selectFrom('users').select('id').execute()).toEqual([]);
    expect(await world.db.selectFrom('sessions').select('id').execute()).toEqual([]);
    expect(world.github.revoked).toEqual(world.github.issued);
  },
);

test('the account of a Bot with the login of a user is still refused by its type', async () => {
  const world = await callbackWorld();
  const bot: FakeAccount = { ...ALICE, type: 'Bot', login: 'renovate[bot]' };
  world.github.account = bot;
  const { response } = await world.signIn();
  expect(response.headers.location).toBe('/login/failed?reason=unsupported_account');
});

test('a person who is already logged in keeps the session when the new login fails', async () => {
  const world = await callbackWorld();
  const first = await world.signIn();
  const cookie = setCookies(first.response)[1]?.split(';')[0] ?? '';
  world.github.answer.user = status(401);
  const second = await world.signIn({ session: cookie });
  expect(second.response.headers.location).toBe('/login/failed?reason=exchange_failed');
  const kept = await world.app.inject({ url: '/api/auth/session', headers: { cookie } });
  expect(kept.statusCode).toBe(200);
});

test('a revocation that GitHub refuses does not stop the login, and the warning holds the status and nothing else', async () => {
  const world = await callbackWorld();
  world.github.answer.revoke = status(500);
  const { response } = await world.signIn();
  expect(response.headers.location).toBe('/');
  const warning = world.logs.lines().find((line) => line['msg'] === 'auth.token_revoke_failed');
  expect(warning).toMatchObject({ level: 40, status: 500 });
  expect(Object.keys(warning ?? {}).sort((a, b) => a.localeCompare(b))).toEqual([
    'hostname',
    'level',
    'msg',
    'pid',
    'reqId',
    'status',
    'time',
  ]);
  expect(world.logs.text()).not.toContain(world.github.issued[0] ?? 'unreachable');
});

test.each([
  ['a 401', status(401), 401],
  ['a 404', status(404), 404],
  ['a 204 that is really a 200', json({ revoked: true }), 200],
  ['a connection that breaks', network, null],
  ['an answer that never comes', stalled, null],
])('a revocation that meets %s logs the status %s and the login succeeds', async (_label, answer, logged) => {
  const world = await callbackWorld({}, { githubTimeoutMs: TIMEOUT_MS });
  world.github.answer.revoke = answer;
  const { response } = await world.signIn();
  expect(response.headers.location).toBe('/');
  const warning = world.logs.lines().find((line) => line['msg'] === 'auth.token_revoke_failed');
  expect(warning?.['status']).toBe(logged);
});

test('a revocation that works leaves no warning', async () => {
  const world = await callbackWorld();
  await world.signIn();
  expect(world.logs.lines().filter((line) => line['msg'] === 'auth.token_revoke_failed')).toEqual([]);
  expect(world.github.revoked).toEqual(world.github.issued);
});

test('a failed login is logged by its reason alone', async () => {
  const world = await callbackWorld();
  world.github.answer.user = status(401);
  await world.signIn();
  const line = world.logs.lines().find((entry) => entry['msg'] === 'auth.login_failed');
  expect(line).toMatchObject({ level: 30, reason: 'exchange_failed' });
  expect(world.logs.text()).not.toContain(ALICE.login);
});
