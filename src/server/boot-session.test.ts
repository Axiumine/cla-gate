// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, onTestFinished, test } from 'vitest';
import { sessionResponseSchema } from '../shared/auth.ts';
import { loadMigrationFiles } from './adapters/db/migration-files.ts';
import { migrate } from './adapters/db/migrator.ts';
import { openPgliteDatabase } from './adapters/db/pglite.ts';
import { createSessionStore } from './adapters/db/sessions.ts';
import { MIGRATIONS_DIRECTORY } from './adapters/db/test-support.ts';
import { expectedToken } from './adapters/http/auth-fixture/test-support.ts';
import { boot } from './boot.ts';
import { AUTH_ENV, TEST_SESSION_SECRET } from './config/auth-fixture/test-support.ts';
import { FakeClock } from './services/test-support.ts';
import { captureLogs, FakeProcess, freePort, UNREACHABLE_DATABASE_URL } from './test-support.ts';

// The session cookie on the real, listening server (E10-S02): boot wires the login routes and hands them its clock.

const START = '2026-11-02T10:00:00.000Z';

async function startWithPerson() {
  const clock = new FakeClock(START);
  const db = await openPgliteDatabase();
  await migrate(db, await loadMigrationFiles(MIGRATIONS_DIRECTORY));
  const user = await db
    .insertInto('users')
    .values({ github_id: 1001, login: 'octocat', name: null, avatar_url: null })
    .returning('id')
    .executeTakeFirstOrThrow();
  const session = await createSessionStore(db, { idleSeconds: 600, absoluteSeconds: 1200 }).create(
    { userId: user.id },
    clock.now(),
  );
  const server = await boot({
    env: {
      DATABASE_URL: UNREACHABLE_DATABASE_URL,
      HOST: '127.0.0.1',
      PORT: String(await freePort()),
      LOG_LEVEL: 'info',
      SESSION_IDLE_SECONDS: '600',
      SESSION_ABSOLUTE_SECONDS: '1200',
      ...AUTH_ENV,
    },
    signals: new FakeProcess(),
    createDb: () => db,
    logDestination: captureLogs().destination,
    reconcileOnStart: false,
    clock,
  });
  onTestFinished(async () => {
    await server?.close();
  });
  const address = server?.address ?? '';
  return { clock, get: (cookie: string) => fetch(`${address}/api/auth/session`, { headers: { cookie } }), session };
}

test('the running server answers /api/auth/session for a session, with the lifetimes and the clock it was started with', async () => {
  const { get, session } = await startWithPerson();
  const response = await get(`__Host-cla_session=${session.id}`);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(sessionResponseSchema.parse(await response.json())).toEqual({
    user: { githubId: 1001, login: 'octocat', name: null, avatarUrl: null },
    expiresAt: '2026-11-02T10:10:00.000Z',
    csrfToken: expectedToken(TEST_SESSION_SECRET, session.csrfSecret),
  });
});

test('the same session is dead once the clock of the server passes its idle expiry', async () => {
  const { clock, get, session } = await startWithPerson();
  clock.advance(600_000);
  const response = await get(`__Host-cla_session=${session.id}`);
  expect(response.status).toBe(401);
  expect(response.headers.get('set-cookie')).toBe(
    '__Host-cla_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
  );
});
