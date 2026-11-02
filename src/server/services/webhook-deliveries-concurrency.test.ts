// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { expect, inject, onTestFinished, test, vi } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { createPgDatabase } from '../adapters/db/pg.ts';
import {
  backendPid,
  migratedTestDatabase,
  realPostgresOnly,
  requireTestDatabaseUrl,
  waitUntilBlocked,
  withConnections,
} from '../adapters/db/test-support.ts';
import { FIXTURE_IDS, webhookFixture } from '../adapters/github/webhook-fixture/test-support.ts';
import { createLogger } from '../adapters/http/logger.ts';
import {
  deliveryHeaders,
  postDelivery,
  SECRET_CURRENT,
  sharedTenantWebhookApp,
} from '../adapters/http/test-support.ts';
import { buildApp } from '../app.ts';
import { deliveryIdSchema } from '../domain/delivery-id.ts';
import type { Job } from '../domain/jobs.ts';
import { captureLogs, testConfig } from '../test-support.ts';
import { createJobsTable, deliveryRows, fakeEnqueuer, jobCount, sentJobs } from './jobs-fixture/test-support.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import { seedTenants } from './tenant-fixture/test-support.ts';
import { createWebhookDeliveries } from './webhook-deliveries.ts';

// E06-S06 on a real Postgres: PGlite has one session, so it can neither race 20 requests for one delivery nor lose a
// connection between the insert and the commit nor show a row lock. Skipped on PGlite, run by the CI `postgres` job.

const ID = deliveryIdSchema.parse('5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c');
const SYNC: Job = { type: 'sync-installation', githubInstallationId: parseGithubId(31_001), deliveryId: ID };
const SUBJECT = { deliveryId: ID, event: 'installation', action: 'created' };
const TWENTY = Array.from({ length: 20 }, (_, index) => index);

const FIXTURE_ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT, GITHUB_APP_ID: String(FIXTURE_IDS.app) };

/** Twenty identical signed deliveries sent at once to `app`: the answers, as `[status, body]`. */
async function twentyIdentical(app: FastifyInstance): Promise<[number, unknown][]> {
  const text = JSON.stringify(webhookFixture('pull_request'));
  const headers = deliveryHeaders(text, { headers: { 'x-github-event': 'pull_request' } });
  const responses = await Promise.all(TWENTY.map(() => postDelivery(app, text, headers)));
  return responses.map((response): [number, unknown] => [response.statusCode, response.json<unknown>()]);
}

function expectOneAcceptedAndTheRestDuplicates(answers: readonly [number, unknown][]): void {
  expect(answers.filter(([status]) => status === 202)).toEqual([[202, { status: 'accepted' }]]);
  expect(answers.filter(([status]) => status === 200)).toEqual(
    Array.from({ length: 19 }, () => [200, { status: 'duplicate' }]),
  );
}

test('20 identical deliveries at once produce one row, one job and the rest 200 duplicate, on whatever engine runs the suite', async () => {
  const { app, db } = await sharedTenantWebhookApp(FIXTURE_ENV);
  onTestFinished(() => app.close());
  expectOneAcceptedAndTheRestDuplicates(await twentyIdentical(app));
  expect(await deliveryRows(db)).toHaveLength(1);
  expect(await jobCount(db)).toBe(1);
});

realPostgresOnly(
  '20 parallel identical deliveries on a pool of real connections produce one row, one job and the rest 200 duplicate',
  async () => {
    const { db } = await migratedTestDatabase();
    await seedTenants(db);
    await createJobsTable(db);
    const config = testConfig(FIXTURE_ENV);
    const app = await buildApp({
      config,
      db: createPgDatabase({
        connectionString: requireTestDatabaseUrl(inject('testDatabaseUrl')),
        onError: console.error,
      }),
      logger: createLogger(config, captureLogs().destination),
      enqueuer: fakeEnqueuer(),
    });
    onTestFinished(() => app.close());
    expectOneAcceptedAndTheRestDuplicates(await twentyIdentical(app));
    expect(await deliveryRows(db)).toHaveLength(1);
    expect(await jobCount(db)).toBe(1);
  },
);

/** An enqueuer that sends, then ends the backend of the transaction it sent on: the commit that follows cannot happen. */
function killingEnqueuer(killer: Parameters<typeof backendPid>[0], pid: number): JobEnqueuer {
  const inner = fakeEnqueuer();
  return {
    async enqueue(tx, job, options) {
      const outcome = await inner.enqueue(tx, job, options);
      await sql`select pg_terminate_backend(${pid})`.execute(killer);
      await vi.waitFor(async () => {
        const { rows } = await sql`select 1 from pg_stat_activity where pid = ${pid}`.execute(killer);
        expect(rows).toHaveLength(0);
      });
      return outcome;
    },
  };
}

realPostgresOnly('a connection killed between the insert and the commit leaves neither row nor job', async () => {
  const { db } = await migratedTestDatabase();
  await createJobsTable(db);
  const connections = withConnections(2);
  const service = connections.get(0);
  const pid = await backendPid(service);
  const deliveries = createWebhookDeliveries({ db: service, enqueuer: killingEnqueuer(connections.get(1), pid) });
  await expect(deliveries.record(SUBJECT, SYNC)).rejects.toThrow();
  expect(await deliveryRows(db)).toEqual([]);
  expect(await jobCount(db)).toBe(0);
});

realPostgresOnly('a redelivery after the killed connection is recorded as new and its job sent', async () => {
  const { db } = await migratedTestDatabase();
  await createJobsTable(db);
  const connections = withConnections(3);
  const doomed = createWebhookDeliveries({
    db: connections.get(0),
    enqueuer: killingEnqueuer(connections.get(1), await backendPid(connections.get(0))),
  });
  await expect(doomed.record(SUBJECT, SYNC)).rejects.toThrow();
  const redelivery = createWebhookDeliveries({ db: connections.get(2), enqueuer: fakeEnqueuer() });
  expect(await redelivery.record(SUBJECT, SYNC)).toBe('accepted');
  expect(await deliveryRows(db)).toHaveLength(1);
  expect((await sentJobs(db)).map((sent) => sent.idempotencyKey)).toEqual([ID]);
});

realPostgresOnly(
  'a delivery whose row is locked by another session waits, and is a duplicate once that session finishes it',
  async () => {
    const { db } = await migratedTestDatabase();
    await createJobsTable(db);
    const connections = withConnections(3);
    const holder = connections.get(0);
    const enqueuer = fakeEnqueuer();
    const deliveries = createWebhookDeliveries({ db: connections.get(1), enqueuer });
    await deliveries.record(SUBJECT, SYNC);
    const waiter = await backendPid(connections.get(1));
    await sql`begin`.execute(holder);
    await sql`select 1 from webhook_deliveries where delivery_id = ${ID} for update`.execute(holder);
    const waiting = deliveries.record(SUBJECT, SYNC);
    await waitUntilBlocked(connections.get(2), waiter);
    await sql`update webhook_deliveries set processed_at = now() where delivery_id = ${ID}`.execute(holder);
    await sql`commit`.execute(holder);
    expect(await waiting).toBe('duplicate');
    expect(enqueuer.calls).toHaveLength(1);
  },
);
