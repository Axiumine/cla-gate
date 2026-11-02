// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import crypto from 'node:crypto';
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { sessionResponseSchema } from '../../../shared/auth.ts';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { COOKIE_NAME } from './auth-fixture/test-support.ts';
import { ALICE, callbackWorld, setCookies } from './callback-fixture/test-support.ts';
import { OAUTH_COOKIE_NAME } from './login-fixture/test-support.ts';

// GET /api/auth/callback (E10-S05), what happens to the session the browser already holds: it ends with the login (session
// fixation), a new id is issued, and a failure anywhere leaves everything as it was.

const sessionCookieOf = (setCookie: string[]): string => (setCookie[1] ?? '').split(';')[0] ?? '';
const hash = (id: string): string => crypto.createHash('sha256').update(id).digest('hex');

test('a session cookie presented on the callback has its row deleted, the new cookie is another id, the old one gets 401', async () => {
  const world = await callbackWorld();
  const old = await world.login(ALICE.id);
  const { response } = await world.signIn({ session: old.cookie });
  expect(response.headers.location).toBe('/');
  const fresh = sessionCookieOf(setCookies(response));
  expect(fresh).toMatch(/^__Host-cla_session=[A-Za-z0-9_-]{43}$/);
  expect(fresh).not.toBe(old.cookie);
  const rows = await world.db.selectFrom('sessions').select(['id', 'session_hash']).execute();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.id).not.toBe(old.sessionId);
  expect(rows[0]?.session_hash).not.toBe(hash(old.id));
  expect(rows[0]?.session_hash).toBe(hash(fresh.slice(`${COOKIE_NAME}=`.length)));
  const oldAfter = await world.app.inject({ url: '/api/auth/session', headers: { cookie: old.cookie } });
  expect(oldAfter.statusCode).toBe(401);
  const freshAfter = await world.app.inject({ url: '/api/auth/session', headers: { cookie: fresh } });
  expect(freshAfter.statusCode).toBe(200);
});

test('the old session is not reused: its CSRF token stops working and the new session has its own', async () => {
  const world = await callbackWorld();
  const old = await world.login(ALICE.id);
  const { response } = await world.signIn({ session: old.cookie });
  const fresh = sessionCookieOf(setCookies(response));
  const mutate = (cookie: string, token: string) =>
    world.app.inject({
      method: 'POST',
      url: '/probe/mutate',
      headers: { cookie, origin: world.origin, 'x-csrf-token': token, 'content-type': 'application/json' },
      payload: '{}',
    });
  expect((await mutate(old.cookie, old.token)).statusCode).toBe(401);
  const seen = await world.app.inject({ url: '/api/auth/session', headers: { cookie: fresh } });
  const token = sessionResponseSchema.parse(seen.json()).csrfToken;
  expect(token).not.toBe(old.token);
  expect((await mutate(fresh, token)).statusCode).toBe(200);
});

test('the verified addresses go into the new row, not the old one', async () => {
  const world = await callbackWorld();
  const old = await world.login(ALICE.id);
  await world.db
    .updateTable('sessions')
    .set({ verified_emails: JSON.stringify([{ email: 'old@example.org', primary: true }]) })
    .execute();
  await world.signIn({ session: old.cookie });
  const rows = await world.db.selectFrom('sessions').select('verified_emails').execute();
  expect(rows).toHaveLength(1);
  expect(JSON.stringify(rows[0]?.verified_emails)).toContain('alice@example.org');
  expect(JSON.stringify(rows[0]?.verified_emails)).not.toContain('old@example.org');
});

test("only the presented session ends: the person's other sessions and other people's stay", async () => {
  const world = await callbackWorld();
  const laptop = await world.login(ALICE.id);
  const phone = await world.login(ALICE.id);
  const bob = await world.login(2002);
  await world.signIn({ session: laptop.cookie });
  const alive = await Promise.all(
    [laptop, phone, bob].map(async (session) => {
      const seen = await world.app.inject({ url: '/api/auth/session', headers: { cookie: session.cookie } });
      return seen.statusCode;
    }),
  );
  expect(alive).toEqual([401, 200, 200]);
});

test('a session of another person presented on the callback ends too, and the callback logs in the person who signed in', async () => {
  const world = await callbackWorld();
  const bob = await world.login(2002);
  const otherBobSession = await world.login(2002);
  const { response } = await world.signIn({ session: bob.cookie });
  const fresh = sessionCookieOf(setCookies(response));
  const owner = await world.db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select('users.github_id')
    .where('sessions.session_hash', '=', hash(fresh.slice(`${COOKIE_NAME}=`.length)))
    .executeTakeFirstOrThrow();
  expect(owner.github_id).toBe(ALICE.id);
  const bobAfter = await world.app.inject({ url: '/api/auth/session', headers: { cookie: bob.cookie } });
  const otherAfter = await world.app.inject({ url: '/api/auth/session', headers: { cookie: otherBobSession.cookie } });
  expect([bobAfter.statusCode, otherAfter.statusCode]).toEqual([401, 200]);
});

test.each([
  ['a forged id of the right shape', `${COOKIE_NAME}=${'A'.repeat(43)}`],
  ['an id of the wrong length', `${COOKIE_NAME}=short`],
  ['a cookie of another name', 'session=anything'],
])('%s on the callback is ignored: the login works and no other session is touched', async (_label, session) => {
  const world = await callbackWorld();
  const bystander = await world.login(2002);
  const { response } = await world.signIn({ session });
  expect(response.headers.location).toBe('/');
  const still = await world.app.inject({ url: '/api/auth/session', headers: { cookie: bystander.cookie } });
  expect(still.statusCode).toBe(200);
  expect(await world.db.selectFrom('sessions').select('id').execute()).toHaveLength(2);
});

test('an expired session presented on the callback is already gone, and the login works', async () => {
  const world = await callbackWorld();
  const old = await world.login(ALICE.id);
  world.advance(604_801);
  const started = await world.start();
  const code = world.github.grant(started.location);
  const response = await world.callback({
    query: { code, state: started.state },
    cookie: `${started.cookie}; ${old.cookie}`,
  });
  expect(response.headers.location).toBe('/');
  const rows = await world.db.selectFrom('sessions').select('id').execute();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.id).not.toBe(old.sessionId);
});

test('the tenth session is kept and the eleventh login evicts the oldest, as for any session', async () => {
  const world = await callbackWorld();
  const sessions: Awaited<ReturnType<typeof world.login>>[] = [];
  for (let index = 0; index < 10; index += 1) {
    world.advance(1);
    sessions.push(await world.login(ALICE.id));
  }
  world.advance(1);
  await world.signIn();
  const rows = await world.db.selectFrom('sessions').select('id').execute();
  expect(rows).toHaveLength(10);
  expect(rows.map((row) => row.id)).not.toContain(sessions[0]?.sessionId);
});

test('a failure while the session is written rolls the user and the deletion back: nothing changes and the person is told', async () => {
  const world = await callbackWorld();
  const kept = await world.login(ALICE.id);
  await sql`
    create function fail_session_insert() returns trigger language plpgsql as $$ begin raise exception 'made-up failure'; end $$
  `.execute(world.db);
  await sql`
    create trigger fail_session_insert before insert on sessions for each row execute function fail_session_insert()
  `.execute(world.db);
  const { response } = await world.signIn({ session: kept.cookie });
  expect(response.statusCode).toBe(500);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('internal_server_error');
  expect(setCookies(response)).toEqual([`${OAUTH_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`]);
  const users = await world.db.selectFrom('users').select(['github_id', 'login', 'name']).execute();
  expect(users).toEqual([{ github_id: ALICE.id, login: 'login-1001', name: 'Name 1001' }]);
  const alive = await world.app.inject({ url: '/api/auth/session', headers: { cookie: kept.cookie } });
  expect(alive.statusCode).toBe(200);
  expect(world.logs.text()).not.toContain(world.github.issued[0] ?? 'unreachable');
  expect(world.github.revoked).toEqual(world.github.issued);
});
