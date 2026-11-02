// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { authWorld, COOKIE_NAME } from './auth-fixture/test-support.ts';

// request.auth and requireAuth (E10-S02): the only way a route learns who is calling.

const probe = z.object({ auth: z.unknown(), presented: z.boolean() });
const touchedAt = (db: Awaited<ReturnType<typeof authWorld>>['db'], sessionId: number) =>
  db.selectFrom('sessions').select('last_seen_at').where('id', '=', sessionId).executeTakeFirstOrThrow();

test('request.auth carries the internal user id, the GitHub id and the display snapshot, the session handle and the CSRF secret', async () => {
  const { app, login } = await authWorld();
  const alice = await login(1001);
  const response = await app.inject({ url: '/probe/auth', headers: { cookie: alice.cookie } });
  expect(probe.parse(response.json())).toEqual({
    presented: true,
    auth: {
      user: { id: alice.userId, githubId: 1001, login: 'login-1001', name: 'Name 1001', avatarUrl: null },
      sessionId: alice.sessionId,
      csrfSecret: alice.csrfSecret,
      expiresAt: '2026-11-02T18:00:00.000Z',
    },
  });
});

test('request.auth is null without a session, and the cookie is reported as not presented', async () => {
  const { app } = await authWorld();
  const response = await app.inject('/probe/auth');
  expect(probe.parse(response.json())).toEqual({ auth: null, presented: false });
});

test('request.auth is null for a dead cookie, which is reported as presented', async () => {
  const { app } = await authWorld();
  const response = await app.inject({ url: '/probe/auth', headers: { cookie: `${COOKIE_NAME}=${'B'.repeat(43)}` } });
  expect(probe.parse(response.json())).toEqual({ auth: null, presented: true });
});

test('every authenticated request touches the session, but the store writes at most once a minute', async () => {
  const { app, advance, db, login, queries } = await authWorld();
  const alice = await login(1001);
  const get = () => app.inject({ url: '/probe/auth', headers: { cookie: alice.cookie } });
  advance(30);
  await get();
  expect((await touchedAt(db, alice.sessionId)).last_seen_at).toEqual(new Date('2026-11-02T10:00:00.000Z'));
  advance(31);
  await get();
  expect((await touchedAt(db, alice.sessionId)).last_seen_at).toEqual(new Date('2026-11-02T10:01:01.000Z'));
  queries.length = 0;
  advance(60);
  await get();
  expect(queries).toEqual(['SelectQueryNode']);
  advance(1);
  await get();
  expect(queries).toEqual(['SelectQueryNode', 'SelectQueryNode', 'UpdateQueryNode']);
  expect((await touchedAt(db, alice.sessionId)).last_seen_at).toEqual(new Date('2026-11-02T10:02:02.000Z'));
});

test('a request for a path that is no API route still authenticates, so a probe route sees the caller', async () => {
  const { app, login } = await authWorld();
  const alice = await login(1001);
  const response = await app.inject({ url: '/probe/protected', headers: { cookie: alice.cookie } });
  expect(response.json()).toEqual({ githubId: 1001 });
});

test('requireAuth throws the standard 401 and does not clear a dead cookie on a route other than the session one', async () => {
  const { app } = await authWorld();
  const response = await app.inject({
    url: '/probe/protected',
    headers: { cookie: `${COOKIE_NAME}=${'B'.repeat(43)}` },
  });
  expect(response.statusCode).toBe(401);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('unauthorized');
  expect(response.headers['set-cookie']).toBeUndefined();
});

test('a session that belongs to one person never answers as another, even with the same cookie on a second request', async () => {
  const { app, login } = await authWorld();
  const alice = await login(1001);
  const bob = await login(2002);
  const ids = await Promise.all(
    [alice, bob, alice, bob].map(async (person) => {
      const response = await app.inject({ url: '/probe/protected', headers: { cookie: person.cookie } });
      return z.object({ githubId: z.number() }).parse(response.json()).githubId;
    }),
  );
  expect(ids).toEqual([1001, 2002, 1001, 2002]);
});

test.each([
  ['a successful answer', '/api/auth/session', 200],
  ['a 401', '/api/auth/session', 401],
  ['a 404 below /api/auth', '/api/auth/nothing-here', 404],
  ['a 404 for /api/auth itself', '/api/auth', 404],
  ['a route spelled with an escape', '/api/%61uth/session', 401],
  ['a query string', '/api/auth/nothing-here?x=1', 404],
  ['a server error', '/api/auth/probe-boom', 500],
])('%s under /api/auth carries Cache-Control: no-store', async (label, url, status) => {
  const { app, login } = await authWorld();
  const alice = await login(1001);
  const headers = status === 200 ? { cookie: alice.cookie } : {};
  const response = await app.inject({ url, headers });
  expect(response.statusCode).toBe(status);
  expect(response.headers['cache-control'], label).toBe('no-store');
});

test.each([['/healthz'], ['/api/authors'], ['/api/nothing'], ['/probe/auth']])(
  '%s is not under /api/auth and is not marked no-store',
  async (url) => {
    const { app } = await authWorld();
    const response = await app.inject(url);
    expect(response.headers['cache-control']).toBeUndefined();
  },
);
