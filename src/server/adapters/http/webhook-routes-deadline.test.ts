// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import crypto from 'node:crypto';
import { type Kysely, type KyselyPlugin, sql } from 'kysely';
import { expect, inject, onTestFinished, test, vi } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { buildApp } from '../../app.ts';
import { createJobsTable, deliveryRows, fakeEnqueuer, jobCount } from '../../services/jobs-fixture/test-support.ts';
import type { JobEnqueuer } from '../../services/ports/jobs.ts';
import { seedTenants, tenantDatabase } from '../../services/tenant-fixture/test-support.ts';
import { captureLogs, testApp, testConfig } from '../../test-support.ts';
import { createPgDatabase } from '../db/pg.ts';
import type { Database } from '../db/schema.ts';
import { migratedTestDatabase, realPostgresOnly, requireTestDatabaseUrl } from '../db/test-support.ts';
import { FIXTURE_IDS, webhookFixture } from '../github/webhook-fixture/test-support.ts';
import { createLogger } from './logger.ts';
import { deliveryHeaders, postDelivery, SECRET_CURRENT, watchTimingSafeEqual } from './test-support.ts';
import { WEBHOOK_DEADLINE_MS } from './webhook-deadline.ts';

// The 8 second deadline of the webhook handler over the route (E06-S07): a handler that has not finished answers 503
// webhook_timeout and rolls back, so GitHub's 10 seconds are never reached and nothing is half recorded.

const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT, GITHUB_APP_ID: String(FIXTURE_IDS.app) };
const PULL_REQUEST = JSON.stringify(webhookFixture('pull_request'));
const PR_HEADERS = deliveryHeaders(PULL_REQUEST, { headers: { 'x-github-event': 'pull_request' } });

/**
 * The real app on a pool of real connections to the throw-away database of this run (E20-S03): the tenants are stored, the
 * fake queue's table exists, and `db` is a second handle on the same database for the assertions. Only a
 * `realPostgresOnly` test calls it, and it is closed after the test.
 */
async function realApp(enqueuer: JobEnqueuer, webhookDeadlineMs: number) {
  const { db } = await migratedTestDatabase();
  await seedTenants(db);
  await createJobsTable(db);
  const config = testConfig(ENV);
  const app = await buildApp({
    config,
    db: createPgDatabase({
      connectionString: requireTestDatabaseUrl(inject('testDatabaseUrl')),
      onError: console.error,
    }),
    logger: createLogger(config, captureLogs().destination),
    enqueuer,
    webhookDeadlineMs,
  });
  onTestFinished(() => app.close());
  return { app, db };
}

/** How many other sessions of this database are inside a transaction right now (idle in transaction, or busy in one). */
async function openTransactions(db: Kysely<Database>): Promise<number> {
  const { rows } = await sql<{ open: number }>`
    select count(*)::int as open from pg_stat_activity
    where datname = current_database() and pid <> pg_backend_pid() and xact_start is not null`.execute(db);
  return rows[0]?.open ?? 0;
}

/** A tenant database with the fake queue's table, and an enqueuer that holds every send until the test lets it go. */
async function heldSends() {
  const db = await tenantDatabase();
  await createJobsTable(db);
  const release = Promise.withResolvers<undefined>();
  const inner = fakeEnqueuer();
  const enqueuer: JobEnqueuer = {
    async enqueue(tx, job, options) {
      await release.promise;
      return inner.enqueue(tx, job, options);
    },
  };
  return {
    db,
    enqueuer,
    inner,
    release: () => {
      release.resolve(undefined);
    },
  };
}

test('a send that outlasts the deadline is a 503 webhook_timeout in the standard body, and nothing is left behind', async () => {
  const { db, enqueuer, inner, release } = await heldSends();
  const { app, logs } = await testApp({ env: ENV, db, enqueuer, webhookDeadlineMs: 50 });
  const response = await postDelivery(app, PULL_REQUEST, PR_HEADERS);
  expect(response.statusCode).toBe(503);
  expect(errorResponseSchema.parse(response.json())).toEqual({
    error: { code: 'webhook_timeout', message: 'Service Unavailable', requestId: response.headers['x-request-id'] },
  });
  release();
  // The query waits for the transaction that still holds the connection: it returns once that has rolled back.
  expect(await deliveryRows(db)).toEqual([]);
  expect(await jobCount(db)).toBe(0);
  expect(inner.calls).toHaveLength(1);
  const written = logs.lines();
  expect(written.filter((line) => line['msg'] === 'webhook.enqueue_failed')).toEqual([]);
  expect(written.filter((line) => line['msg'] === 'webhook.received')).toMatchObject([
    { outcome: 'rejected', reason: 'webhook_timeout' },
  ]);
});

test('a redelivery after the timeout is recorded as new: the rolled-back row does not make it a duplicate', async () => {
  const { db, enqueuer, release } = await heldSends();
  const { app } = await testApp({ env: ENV, db, enqueuer, webhookDeadlineMs: 50 });
  expect((await postDelivery(app, PULL_REQUEST, PR_HEADERS)).statusCode).toBe(503);
  release();
  const redelivered = await postDelivery(app, PULL_REQUEST, PR_HEADERS);
  expect(redelivered.statusCode).toBe(202);
  expect(redelivered.json()).toEqual({ status: 'accepted' });
  expect(await deliveryRows(db)).toHaveLength(1);
  expect(await jobCount(db)).toBe(1);
});

test('a database read that outlasts the deadline is the same 503, and once it returns nothing is recorded or sent', async () => {
  const db = await tenantDatabase();
  await createJobsTable(db);
  const release = Promise.withResolvers<undefined>();
  const slow: KyselyPlugin = {
    transformQuery: ({ node }) => node,
    transformResult: async ({ result }) => {
      await release.promise;
      return result;
    },
  };
  const enqueuer = fakeEnqueuer();
  const { app, logs } = await testApp({ env: ENV, db: db.withPlugin(slow), enqueuer, webhookDeadlineMs: 50 });
  const response = await postDelivery(app, PULL_REQUEST, PR_HEADERS);
  expect(response.statusCode).toBe(503);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('webhook_timeout');
  release.resolve(undefined);
  expect(await deliveryRows(db)).toEqual([]);
  expect(enqueuer.calls).toEqual([]);
  expect(logs.lines().filter((line) => line['msg'] === 'webhook.enqueue_failed')).toEqual([]);
});

test('a delivery that finishes inside the deadline is answered as usual', async () => {
  const db = await tenantDatabase();
  await createJobsTable(db);
  const { app } = await testApp({ env: ENV, db, enqueuer: fakeEnqueuer(), webhookDeadlineMs: 20_000 });
  const response = await postDelivery(app, PULL_REQUEST, PR_HEADERS);
  expect([response.statusCode, response.json()]).toEqual([202, { status: 'accepted' }]);
});

test('the default deadline is 8 seconds counted from the arrival of the request: 100 ms are left once 7.9 s have gone', async () => {
  const { db, enqueuer, release } = await heldSends();
  const { app } = await testApp({ env: ENV, db, enqueuer });
  // The signature check runs between the arrival and the handler: it is the moment the clock of the request jumps ahead.
  const realClock = performance.now.bind(performance);
  const realCompare = crypto.timingSafeEqual;
  const shift = { ms: 0 };
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => realClock() + shift.ms);
  onTestFinished(() => {
    clock.mockRestore();
  });
  watchTimingSafeEqual().mockImplementation((a, b) => {
    shift.ms = WEBHOOK_DEADLINE_MS - 100;
    return realCompare(a, b);
  });
  const started = realClock();
  const response = await postDelivery(app, PULL_REQUEST, PR_HEADERS);
  const elapsed = realClock() - started;
  expect(response.statusCode).toBe(503);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('webhook_timeout');
  // A deadline of 5 s would have expired at once, and one of 10 s would still have 2 s to wait.
  expect(elapsed).toBeGreaterThan(50);
  expect(elapsed).toBeLessThan(1000);
  release();
});

realPostgresOnly(
  'on a real server a statement still running at the deadline does not delay the 503, and the transaction rolls back when it returns',
  async () => {
    const inner = fakeEnqueuer();
    const enqueuer: JobEnqueuer = {
      async enqueue(tx, job, options) {
        await sql`select pg_sleep(0.6)`.execute(tx);
        return inner.enqueue(tx, job, options);
      },
    };
    const { app, db } = await realApp(enqueuer, 100);
    const started = performance.now();
    const response = await postDelivery(app, PULL_REQUEST, PR_HEADERS);
    const elapsed = performance.now() - started;
    expect(response.statusCode).toBe(503);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe('webhook_timeout');
    // The answer came at the deadline, while the database was still sleeping inside the transaction.
    expect(elapsed).toBeLessThan(500);
    await vi.waitFor(async () => {
      expect(await openTransactions(db)).toBe(0);
    });
    expect(await deliveryRows(db)).toEqual([]);
    expect(await jobCount(db)).toBe(0);
  },
);
