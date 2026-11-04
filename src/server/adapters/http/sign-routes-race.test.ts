// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, inject, test } from 'vitest';
import { SIGN_PATH } from '../../../shared/sign.ts';
import { AUTH_ENV, TEST_SESSION_SECRET } from '../../config/auth-fixture/test-support.ts';
import { FakeClock } from '../../services/test-support.ts';
import { testApp, testConfig } from '../../test-support.ts';
import { createSessionStore } from '../db/sessions.ts';
import { migratedTestDatabase, openTestDatabase, realPostgresOnly, seedTenant } from '../db/test-support.ts';
import { COOKIE_NAME, expectedToken } from './auth-fixture/test-support.ts';
import { serveTenant } from './sign-context-fixture/test-support.ts';
import { ADA_EMAIL, bodyFor } from './sign-fixture/test-support.ts';

// Simultaneous sign requests (E13-S04), over HTTP, on a real server: ten requests of one person at once, identical or with ten
// different names, give exactly one signature, one signer_pii row and one audit row, with one 201 and nine 200. PGlite has one
// connection, so its requests are served one after the other and cannot race: the sequential cases, which give the same outcome
// on whatever engine runs the suite, are in sign-routes-replay.test.ts. The statement level (`on conflict do nothing` waits for
// a concurrent insert of the same key) is what these tests rely on, not something they show on their own.

const T0 = '2026-11-02T10:00:00.000Z';
const SIMULTANEOUS = 10;

/** The app on its own pool of the throw-away database, one tenant and one logged-in person with a verified address. */
async function raceWorld() {
  const { db } = await migratedTestDatabase();
  const t1 = await seedTenant(db, 1);
  await serveTenant(db, t1);
  const clock = new FakeClock(T0);
  const url = inject('testDatabaseUrl');
  // On PGlite there is one database and the app uses it; on Postgres the app has a pool of its own, so requests overlap.
  const appDb = url === undefined ? db : (await openTestDatabase(url)).db;
  const { app } = await testApp({ env: AUTH_ENV, db: appDb, clock });
  const config = testConfig(AUTH_ENV);
  const store = createSessionStore(db, config.session);
  const user = await db
    .insertInto('users')
    .values({ github_id: 1234, login: 'login-1234', name: null, avatar_url: null })
    .returning('id')
    .executeTakeFirstOrThrow();
  const created = await store.create({ userId: user.id, verifiedEmails: [ADA_EMAIL] }, clock.now());
  const headers = {
    cookie: `${COOKIE_NAME}=${created.id}`,
    origin: new URL(config.publicBaseUrl).origin,
    'x-csrf-token': expectedToken(TEST_SESSION_SECRET, created.csrfSecret),
    'content-type': 'application/json',
  };
  const send = (overrides: Readonly<Record<string, unknown>>) =>
    app.inject({ method: 'POST', url: SIGN_PATH, headers, payload: JSON.stringify(bodyFor(t1, 1, overrides)) });
  return { db, send };
}

test('on whatever engine runs the suite, the same request twice over the app of this file is a 201 and then a 200, with one row of each table', async () => {
  const { db, send } = await raceWorld();
  const first = await send({});
  const second = await send({});
  expect([first.statusCode, second.statusCode]).toEqual([201, 200]);
  expect(await db.selectFrom('signatures').select('id').execute()).toHaveLength(1);
  expect(await db.selectFrom('signer_pii').select('signature_id').execute()).toHaveLength(1);
  expect(
    await db.selectFrom('audit_log').select('id').where('action', '=', 'signature.created').execute(),
  ).toHaveLength(1);
});

realPostgresOnly(
  'ten simultaneous identical requests give one 201 and nine 200, and one row of each table',
  async () => {
    const { db, send } = await raceWorld();
    const answers = await Promise.all(Array.from({ length: SIMULTANEOUS }, () => send({})));
    expect(answers.map((answer) => answer.statusCode).toSorted((a, b) => a - b)).toEqual([
      ...Array.from({ length: SIMULTANEOUS - 1 }, () => 200),
      201,
    ]);
    expect(await db.selectFrom('signatures').select('id').execute()).toHaveLength(1);
    expect(await db.selectFrom('signer_pii').select('signature_id').execute()).toHaveLength(1);
    expect(
      await db.selectFrom('audit_log').select('id').where('action', '=', 'signature.created').execute(),
    ).toHaveLength(1);
  },
);

realPostgresOnly(
  'ten simultaneous requests with different names give the same outcome, and the stored name is the winner’s',
  async () => {
    const { db, send } = await raceWorld();
    const answers = await Promise.all(
      Array.from({ length: SIMULTANEOUS }, (_, index) => send({ name: `Ada ${index}` })),
    );
    expect(answers.map((answer) => answer.statusCode).toSorted((a, b) => a - b)).toEqual([
      ...Array.from({ length: SIMULTANEOUS - 1 }, () => 200),
      201,
    ]);
    const winner = answers.findIndex((answer) => answer.statusCode === 201);
    expect(await db.selectFrom('signatures').select('id').execute()).toHaveLength(1);
    expect(await db.selectFrom('signer_pii').select('name').execute()).toEqual([{ name: `Ada ${winner}` }]);
    expect(
      await db.selectFrom('audit_log').select('id').where('action', '=', 'signature.created').execute(),
    ).toHaveLength(1);
    const created = answers.map((answer) => answer.json<{ created: boolean }>().created);
    expect(created.filter(Boolean)).toHaveLength(1);
  },
);
