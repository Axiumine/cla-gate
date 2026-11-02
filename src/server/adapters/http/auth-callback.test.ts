// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import crypto from 'node:crypto';
import { expect, test } from 'vitest';
import { sessionResponseSchema } from '../../../shared/auth.ts';
import { TEST_CLIENT_ID, TEST_CLIENT_SECRET } from '../../config/auth-fixture/test-support.ts';
import { COOKIE_NAME } from './auth-fixture/test-support.ts';
import { ALICE, callbackWorld, setCookies } from './callback-fixture/test-support.ts';
import { OAUTH_COOKIE_NAME } from './login-fixture/test-support.ts';

// GET /api/auth/callback (E10-S05), the part that works: the code becomes a token, the token an identity, and the identity a
// new session. The token lives for the length of the request and nowhere else.

const BASE = 'https://app.example.com';
const SESSION_COOKIE =
  /^__Host-cla_session=([A-Za-z0-9_-]{43}); Max-Age=604800; Path=\/; HttpOnly; Secure; SameSite=Lax$/;
const OAUTH_CLEARED = `${OAUTH_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;

test('a signed-in person gets a new session, a redirect to the checked return path and a cleared attempt cookie', async () => {
  const { signIn } = await callbackWorld();
  const { response } = await signIn({ returnTo: '/sign/123?pr=45' });
  expect(response.statusCode).toBe(302);
  expect(response.headers.location).toBe('/sign/123?pr=45');
  const [cleared, session] = setCookies(response);
  expect(cleared).toBe(OAUTH_CLEARED);
  expect(session).toMatch(SESSION_COOKIE);
  expect(setCookies(response)).toHaveLength(2);
});

test('with no return_to the person lands on the front page', async () => {
  const { signIn } = await callbackWorld();
  expect((await signIn()).response.headers.location).toBe('/');
});

test('the new cookie is a working session of the person who signed in, and the SPA never sees a token', async () => {
  const { signIn, app } = await callbackWorld();
  const { response } = await signIn();
  const id = SESSION_COOKIE.exec(setCookies(response)[1] ?? '')?.[1];
  const seen = await app.inject({ url: '/api/auth/session', headers: { cookie: `${COOKIE_NAME}=${id}` } });
  expect(seen.statusCode).toBe(200);
  const body = sessionResponseSchema.parse(seen.json());
  expect(body.user).toEqual({
    githubId: ALICE.id,
    login: ALICE.login,
    name: ALICE.name,
    avatarUrl: ALICE.avatarUrl,
  });
  expect(JSON.stringify([response.body, response.headers, seen.body])).not.toContain('ghu_');
});

test('GitHub is called in order: exchange, the user, the addresses, then the revocation of the token', async () => {
  const { signIn, github } = await callbackWorld();
  await signIn();
  expect(github.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
    'POST https://github.com/login/oauth/access_token',
    'GET https://api.github.com/user',
    'GET https://api.github.com/user/emails?per_page=100',
    `DELETE https://api.github.com/applications/${TEST_CLIENT_ID}/token`,
  ]);
});

test('the exchange carries the client, the code, the redirect URI and the PKCE verifier from the cookie, and asks for JSON', async () => {
  const { signIn, github } = await callbackWorld();
  const { started, code } = await signIn();
  const exchange = github.requests[0];
  expect(exchange?.headers['accept']).toBe('application/json');
  expect(exchange?.headers['content-type']).toBe('application/x-www-form-urlencoded');
  expect(Object.fromEntries(new URLSearchParams(exchange?.body))).toEqual({
    client_id: TEST_CLIENT_ID,
    client_secret: TEST_CLIENT_SECRET,
    code,
    redirect_uri: `${BASE}/api/auth/callback`,
    code_verifier: started.sent.attempt.v,
  });
});

test('the identity calls carry the bearer token and the API version, and the revocation uses Basic authentication', async () => {
  const { signIn, github } = await callbackWorld();
  await signIn();
  const [, user, emails, revoke] = github.requests;
  const token = github.issued[0];
  expect(token).toBeDefined();
  for (const request of [user, emails]) {
    expect(request?.headers['authorization']).toBe(`Bearer ${token}`);
    expect(request?.headers['x-github-api-version']).toBe('2022-11-28');
    expect(request?.headers['user-agent']).toMatch(/^cla-gate\//);
  }
  const basic = Buffer.from(`${TEST_CLIENT_ID}:${TEST_CLIENT_SECRET}`).toString('base64');
  expect(revoke?.headers['authorization']).toBe(`Basic ${basic}`);
  expect(JSON.parse(revoke?.body ?? '')).toEqual({ access_token: token });
  expect(github.revoked).toEqual([token]);
});

test('the token and the code stay out of the logs, the database and the response; the refresh token is dropped', async () => {
  const { signIn, github, logs, db } = await callbackWorld();
  const { response, code, started } = await signIn();
  const token = github.issued[0] ?? '';
  const stored = JSON.stringify([
    await db.selectFrom('users').selectAll().execute(),
    await db.selectFrom('sessions').selectAll().execute(),
    await db.selectFrom('audit_log').selectAll().execute(),
  ]);
  const everywhere = [logs.text(), stored, response.body, JSON.stringify(response.headers)].join('\n');
  for (const secret of [token, code, 'ghr_made-up-refresh', started.sent.attempt.v, TEST_CLIENT_SECRET]) {
    expect(secret).not.toBe('');
    expect(everywhere).not.toContain(secret);
  }
});

test('the callback answers Cache-Control: no-store', async () => {
  const { signIn } = await callbackWorld();
  expect((await signIn()).response.headers['cache-control']).toBe('no-store');
});

test('the session row holds the hash of the id, the verified addresses of this login and no unverified one', async () => {
  const { signIn, db, store } = await callbackWorld();
  const { response } = await signIn();
  const id = SESSION_COOKIE.exec(setCookies(response)[1] ?? '')?.[1] ?? '';
  const row = await db.selectFrom('sessions').selectAll().executeTakeFirstOrThrow();
  expect(row.session_hash).toBe(crypto.createHash('sha256').update(id).digest('hex'));
  expect(row.session_hash).not.toBe(id);
  expect(await store.verifiedEmails(row.id)).toEqual([
    { email: 'alice@example.org', primary: true },
    { email: 'alice.work@example.org', primary: false },
  ]);
});

test('the user is created by numeric GitHub id with the display snapshot', async () => {
  const { signIn, db } = await callbackWorld();
  await signIn();
  const users = await db.selectFrom('users').select(['github_id', 'login', 'name', 'avatar_url']).execute();
  expect(users).toEqual([{ github_id: ALICE.id, login: ALICE.login, name: ALICE.name, avatar_url: ALICE.avatarUrl }]);
});

test('a second login of the same person refreshes the snapshot of the same row and adds a session', async () => {
  const { signIn, github, db } = await callbackWorld();
  await signIn();
  const first = await db.selectFrom('users').select(['id', 'created_at']).executeTakeFirstOrThrow();
  github.account = { ...ALICE, login: 'alice-renamed', name: null, avatarUrl: null };
  await signIn();
  const users = await db.selectFrom('users').selectAll().execute();
  expect(users).toHaveLength(1);
  expect(users[0]).toMatchObject({
    id: first.id,
    github_id: ALICE.id,
    login: 'alice-renamed',
    name: null,
    avatar_url: null,
  });
  expect(users[0]?.created_at).toEqual(first.created_at);
  expect(await db.selectFrom('sessions').select('id').execute()).toHaveLength(2);
});

test('a login is keyed on the id: another person with the same login is another row', async () => {
  const { signIn, github, db } = await callbackWorld();
  await signIn();
  github.account = { ...ALICE, id: 2002 };
  await signIn();
  const users = await db.selectFrom('users').select(['github_id', 'login']).orderBy('github_id').execute();
  expect(users).toEqual([
    { github_id: 1001, login: 'alice' },
    { github_id: 2002, login: 'alice' },
  ]);
});

test('two people each get their own session: no cookie shows the other person', async () => {
  const { signIn, github, app } = await callbackWorld();
  const alice = await signIn();
  github.account = { ...ALICE, id: 2002, login: 'bob', name: 'Bob', avatarUrl: null };
  const bob = await signIn();
  const seen: number[] = [];
  for (const { response } of [alice, bob]) {
    const id = SESSION_COOKIE.exec(setCookies(response)[1] ?? '')?.[1];
    const session = await app.inject({ url: '/api/auth/session', headers: { cookie: `${COOKIE_NAME}=${id}` } });
    seen.push(sessionResponseSchema.parse(session.json()).user.githubId);
  }
  expect(seen).toEqual([1001, 2002]);
});

test('the person is not recorded in the audit log: a login is not a tenant change', async () => {
  const { signIn, db } = await callbackWorld();
  await signIn();
  expect(await db.selectFrom('audit_log').select('id').execute()).toEqual([]);
});
