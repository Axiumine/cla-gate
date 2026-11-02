// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import { CONTEXT, IDS, payloadOf } from '../../domain/test-support.ts';
import { routeWebhook } from '../../domain/webhook-routing.ts';
import { createRevokeUserSessionsHandler } from '../../services/revoke-user-sessions.ts';
import { authWorld } from './auth-fixture/test-support.ts';

// What a revoked App authorization does to the browsers of that person (E10-S07): the `revoke-user-sessions` job runs
// the real handler over a real session store, and the old cookies are then tried against the real application.

const job = (githubUserId: number) => ({ type: 'revoke-user-sessions', githubUserId });

async function world() {
  const base = await authWorld();
  const handler = createRevokeUserSessionsHandler({ sessions: base.store, log: base.app.log });
  const whoAmI = (cookie: string) => base.app.inject({ url: '/api/auth/session', headers: { cookie } });
  const sessionRows = async (userId: number) =>
    (await base.db.selectFrom('sessions').select('id').where('user_id', '=', userId).orderBy('id').execute()).map(
      (row) => row.id,
    );
  return { ...base, handler, whoAmI, sessionRows };
}

test('a user with three sessions revokes: every old cookie gets 401 from GET /api/auth/session', async () => {
  const { handler, whoAmI, login } = await world();
  const devices = [await login(1001), await login(1001), await login(1001)];
  for (const device of devices) {
    expect((await whoAmI(device.cookie)).statusCode).toBe(200);
  }
  expect(await handler(job(1001))).toBe(3);
  for (const device of devices) {
    expect((await whoAmI(device.cookie)).statusCode).toBe(401);
  }
});

test('the old CSRF token and cookie no longer pass a state-changing request', async () => {
  const { app, handler, login } = await world();
  const alice = await login(1001);
  expect((await app.inject({ method: 'POST', url: '/probe/mutate', headers: alice.headers })).statusCode).toBe(200);
  await handler(job(1001));
  expect((await app.inject({ method: 'POST', url: '/probe/mutate', headers: alice.headers })).statusCode).toBe(401);
  expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: alice.headers })).statusCode).toBe(401);
});

test('a second user is unaffected: every session of theirs is still in the table and still works', async () => {
  const { handler, whoAmI, sessionRows, login } = await world();
  const alice = await login(1001);
  await login(1001);
  const bobDevices = [await login(2002), await login(2002)];
  const bobRows = await sessionRows(bobDevices[0]?.userId ?? 0);
  expect(await handler(job(1001))).toBe(2);
  expect(await sessionRows(alice.userId)).toEqual([]);
  expect(await sessionRows(bobDevices[0]?.userId ?? 0)).toEqual(bobRows);
  for (const device of bobDevices) {
    expect((await whoAmI(device.cookie)).statusCode).toBe(200);
  }
});

test('the users row stays, with its identity and display snapshot, because signatures reference it', async () => {
  const { db, handler, login } = await world();
  const alice = await login(1001);
  await handler(job(1001));
  expect(
    await db.selectFrom('users').select(['id', 'github_id', 'login']).where('id', '=', alice.userId).execute(),
  ).toEqual([{ id: alice.userId, github_id: 1001, login: 'login-1001' }]);
});

test('a job for an unknown id completes with count 0 and changes nothing', async () => {
  const { handler, whoAmI, logs, login } = await world();
  const alice = await login(1001);
  expect(await handler(job(987_654))).toBe(0);
  expect((await whoAmI(alice.cookie)).statusCode).toBe(200);
  expect(logs.lines().filter((line) => line['msg'] === 'auth.sessions_revoked')).toMatchObject([
    { githubUserId: 987_654, revoked: 0 },
  ]);
});

test('a job delivered twice is harmless: the second run deletes nothing and reports 0', async () => {
  const { handler, whoAmI, login } = await world();
  const alice = await login(1001);
  expect(await handler(job(1001))).toBe(1);
  expect(await handler(job(1001))).toBe(0);
  expect((await whoAmI(alice.cookie)).statusCode).toBe(401);
});

test('expired session rows of the person go too, so nothing of theirs outlives the revocation', async () => {
  const { db, handler, sessionRows, login } = await world();
  const alice = await login(1001);
  await db
    .insertInto('sessions')
    .values({
      session_hash: 'e'.repeat(64),
      user_id: alice.userId,
      csrf_secret: 'expired-csrf-secret',
      idle_expires_at: new Date('2026-11-02T09:00:00.000Z'),
      absolute_expires_at: new Date('2026-11-02T09:00:00.000Z'),
    })
    .execute();
  expect(await handler(job(1001))).toBe(2);
  expect(await sessionRows(alice.userId)).toEqual([]);
});

test('the person can log in again afterwards: the revocation ends sessions, it does not ban the identity', async () => {
  const { handler, whoAmI, login } = await world();
  const before = await login(1001);
  await handler(job(1001));
  const after = await login(1001);
  expect((await whoAmI(before.cookie)).statusCode).toBe(401);
  expect((await whoAmI(after.cookie)).statusCode).toBe(200);
});

test('the log line names the numeric id and the count and carries no login, name or session value', async () => {
  const { handler, logs, login } = await world();
  const alice = await login(1001);
  await handler(job(1001));
  const text = logs.text();
  expect(logs.lines().filter((line) => line['msg'] === 'auth.sessions_revoked')).toMatchObject([
    { level: 30, githubUserId: 1001, revoked: 1 },
  ]);
  for (const secret of ['login-1001', 'Name 1001', alice.id, alice.csrfSecret]) {
    expect(text).not.toContain(secret);
  }
});

test('an invalid job deletes nothing: a string id, or the id of an internal users.id, leaves every session in place', async () => {
  const { handler, whoAmI, login } = await world();
  const alice = await login(1001);
  await expect(handler({ type: 'revoke-user-sessions', githubUserId: '1001' })).rejects.toMatchObject({
    code: 'job_payload_invalid',
  });
  expect(await handler(job(alice.userId))).toBe(0);
  expect((await whoAmI(alice.cookie)).statusCode).toBe(200);
});

test('the job the webhook intake routes for a revoked authorization is the one this handler takes, and it ends that person only', async () => {
  const { handler, whoAmI, login } = await world();
  const person = await login(IDS.sender);
  const bystander = await login(IDS.account);
  const routing = routeWebhook('github_app_authorization', 'revoked', payloadOf('github_app_authorization'), CONTEXT);
  expect(routing).toMatchObject({ kind: 'job', job: { type: 'revoke-user-sessions', githubUserId: IDS.sender } });
  expect(await handler(z.object({ job: z.unknown() }).parse(routing).job)).toBe(1);
  expect((await whoAmI(person.cookie)).statusCode).toBe(401);
  expect((await whoAmI(bystander.cookie)).statusCode).toBe(200);
});
