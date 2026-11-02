// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { expect, inject, onTestFinished, test } from 'vitest';
import { buildApp } from '../../app.ts';
import { createJobsTable, deliveryRows, fakeEnqueuer, sentJobs } from '../../services/jobs-fixture/test-support.ts';
import type { JobEnqueuer } from '../../services/ports/jobs.ts';
import { seedTenants } from '../../services/tenant-fixture/test-support.ts';
import { captureLogs, testConfig } from '../../test-support.ts';
import { createPgDatabase } from '../db/pg.ts';
import type { Database } from '../db/schema.ts';
import { migratedTestDatabase, realPostgresOnly, requireTestDatabaseUrl } from '../db/test-support.ts';
import {
  FIXTURE_IDS,
  FIXTURE_SHA,
  sorted,
  type WebhookEvent,
  webhookFixture,
} from '../github/webhook-fixture/test-support.ts';
import { createLogger } from './logger.ts';
import { deliveryHeaders, postDelivery, SECRET_CURRENT, sharedTenantWebhookApp } from './test-support.ts';

// The whole fixture set of E06-S03 through the route (E06-S07): one delivery per supported event, and the exact rows and
// jobs each leaves behind, the events that name no repository (`installation`, `github_app_authorization`) included. The
// same assertions run on PGlite in every run and, in the CI `postgres` job, on a pool of real connections with the seven
// deliveries in flight at once.

const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT, GITHUB_APP_ID: String(FIXTURE_IDS.app) };
const tenant = { githubInstallationId: FIXTURE_IDS.installation };
const repository = { ...tenant, githubRepoId: FIXTURE_IDS.repository };

interface Expectation {
  readonly event: WebhookEvent;
  readonly action: string;
  readonly deliveryId: string;
  readonly job: Record<string, unknown>;
}

const EXPECTED: readonly Expectation[] = [
  {
    event: 'pull_request',
    action: 'opened',
    deliveryId: '00000000-0000-4000-8000-000000000001',
    job: { type: 'evaluate-pr', trigger: 'pull_request', ...repository, prNumber: 7 },
  },
  {
    event: 'check_run',
    action: 'rerequested',
    deliveryId: '00000000-0000-4000-8000-000000000002',
    job: { type: 'evaluate-head-sha', ...repository, headSha: FIXTURE_SHA },
  },
  {
    event: 'check_suite',
    action: 'rerequested',
    deliveryId: '00000000-0000-4000-8000-000000000003',
    job: { type: 'evaluate-head-sha', ...repository, headSha: FIXTURE_SHA },
  },
  {
    event: 'issue_comment',
    action: 'created',
    deliveryId: '00000000-0000-4000-8000-000000000004',
    job: { type: 'recheck-comment', ...repository, prNumber: 7, commentId: FIXTURE_IDS.comment },
  },
  {
    event: 'installation',
    action: 'created',
    deliveryId: '00000000-0000-4000-8000-000000000005',
    job: { type: 'sync-installation', ...tenant },
  },
  {
    event: 'installation_repositories',
    action: 'added',
    deliveryId: '00000000-0000-4000-8000-000000000006',
    job: { type: 'sync-installation', ...tenant },
  },
  {
    event: 'github_app_authorization',
    action: 'revoked',
    deliveryId: '00000000-0000-4000-8000-000000000007',
    job: { type: 'revoke-user-sessions', githubUserId: FIXTURE_IDS.sender },
  },
];

/**
 * The real app on a pool of real connections to the throw-away database of this run (E20-S03): the tenants are stored, the
 * fake queue's table exists, and `db` is a second handle on the same database for the assertions. Only a
 * `realPostgresOnly` test calls it, and it is closed after the test.
 */
async function realApp(enqueuer: JobEnqueuer, webhookDeadlineMs?: number) {
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
    ...(webhookDeadlineMs === undefined ? {} : { webhookDeadlineMs }),
  });
  onTestFinished(() => app.close());
  return { app, db };
}

function deliver(app: FastifyInstance, expected: Expectation) {
  const body = JSON.stringify(webhookFixture(expected.event));
  const headers = deliveryHeaders(body, {
    headers: { 'x-github-event': expected.event, 'x-github-delivery': expected.deliveryId },
  });
  return postDelivery(app, body, headers);
}

/** The rows and jobs that exactly the seven deliveries leave: one row each with only its id, event and action, one job each with ids only. */
async function expectExactlyTheFixtureSet(db: Kysely<Database>): Promise<void> {
  const rows = (await deliveryRows(db)).toSorted((a, b) => a.delivery_id.localeCompare(b.delivery_id));
  expect(rows.map((row) => sorted(Object.keys(row)))).toEqual(
    EXPECTED.map(() => ['action', 'delivery_id', 'event', 'processed_at', 'received_at']),
  );
  expect(rows).toMatchObject(
    EXPECTED.map(({ event, action, deliveryId }) => ({
      delivery_id: deliveryId,
      event,
      action,
      processed_at: null,
    })),
  );
  const jobs = (await sentJobs(db)).toSorted((a, b) => a.idempotencyKey.localeCompare(b.idempotencyKey));
  expect(jobs).toEqual(
    EXPECTED.map(({ deliveryId, job }) => ({
      idempotencyKey: deliveryId,
      dedupeKey: null,
      job: { ...job, deliveryId },
    })),
  );
  const stored = JSON.stringify([rows, jobs]);
  expect(stored).not.toContain('fixture-');
  expect(stored).not.toContain('FIXTURE_');
}

test('the fixture set, one delivery per event: each leaves its exact row and its exact job, with ids and no payload', async () => {
  const { app, db } = await sharedTenantWebhookApp(ENV);
  onTestFinished(() => app.close());
  for (const expected of EXPECTED) {
    const response = await deliver(app, expected);
    expect([expected.event, response.statusCode, response.json()]).toEqual([
      expected.event,
      202,
      { status: 'accepted' },
    ]);
  }
  await expectExactlyTheFixtureSet(db);
});

test('the same set sent again is seven duplicates: still the same seven rows and jobs, and nothing that ignores adds one', async () => {
  const { app, db } = await sharedTenantWebhookApp(ENV);
  onTestFinished(() => app.close());
  for (const expected of EXPECTED) {
    await deliver(app, expected);
  }
  for (const expected of EXPECTED) {
    const again = await deliver(app, expected);
    expect([expected.event, again.statusCode, again.json()]).toEqual([expected.event, 200, { status: 'duplicate' }]);
  }
  const body = JSON.stringify({ ref: 'refs/heads/main' });
  const ignored = await postDelivery(
    app,
    body,
    deliveryHeaders(body, {
      headers: { 'x-github-event': 'push', 'x-github-delivery': '00000000-0000-4000-8000-0000000000ff' },
    }),
  );
  expect(ignored.statusCode).toBe(202);
  // A redelivery whose job is still alive leaves its row to that job: it stays unprocessed (E06-S06).
  await expectExactlyTheFixtureSet(db);
});

realPostgresOnly(
  'on a pool of real connections the seven fixture deliveries in flight at once leave the same exact rows and jobs',
  async () => {
    const { app, db } = await realApp(fakeEnqueuer());
    const answers = await Promise.all(EXPECTED.map((expected) => deliver(app, expected)));
    expect(answers.map((response) => [response.statusCode, response.json<unknown>()])).toEqual(
      EXPECTED.map(() => [202, { status: 'accepted' }]),
    );
    await expectExactlyTheFixtureSet(db);
  },
);
