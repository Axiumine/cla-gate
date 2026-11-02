// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { InsertQueryNode, type KyselyPlugin } from 'kysely';
import { afterAll, expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import {
  clearRecords,
  createJobsTable,
  deliveryRows,
  fakeEnqueuer,
  jobCount,
} from '../../services/jobs-fixture/test-support.ts';
import { tenantDatabase } from '../../services/tenant-fixture/test-support.ts';
import { testApp } from '../../test-support.ts';
import { FIXTURE_IDS, webhookFixture, withValue } from '../github/webhook-fixture/test-support.ts';
import { deliveryHeaders, postDelivery, SECRET_CURRENT, sharedTenantWebhookApp } from './test-support.ts';

// A delivery whose recording or send fails (E06-S06): the transaction is rolled back, so a row never exists without its
// job, the answer is a 503 that GitHub's delivery log shows, and a redelivery works.

const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT, GITHUB_APP_ID: String(FIXTURE_IDS.app) };
const ID = '5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c';
const CANARY = 'canary-value-8e1f5b2a';

type Running = Awaited<ReturnType<typeof sharedTenantWebhookApp>>;

let started: Promise<Running> | undefined;
afterAll(async () => {
  await (await started)?.app.close();
});

async function running(): Promise<Running> {
  started ??= sharedTenantWebhookApp(ENV);
  const server = await started;
  server.failSends(undefined);
  await clearRecords(server.db);
  server.enqueuer.calls.length = 0;
  return server;
}

function deliver(app: Running['app'], event: string, body: unknown, id = ID) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return postDelivery(
    app,
    text,
    deliveryHeaders(text, { headers: { 'x-github-event': event, 'x-github-delivery': id } }),
  );
}

const pullRequest = () => withValue(webhookFixture('pull_request'), 'pull_request.title', CANARY);

test('a send that fails is a 503 webhook_enqueue_failed in the standard error body, and nothing is kept', async () => {
  const { app, db, failSends } = await running();
  failSends(new Error('the queue is down'));
  const response = await deliver(app, 'pull_request', pullRequest());
  expect(response.statusCode).toBe(503);
  expect(errorResponseSchema.parse(response.json())).toEqual({
    error: {
      code: 'webhook_enqueue_failed',
      message: 'Service Unavailable',
      requestId: response.headers['x-request-id'],
    },
  });
  expect(await deliveryRows(db)).toEqual([]);
  expect(await jobCount(db)).toBe(0);
});

test('a redelivery after the failure works: the same delivery id is recorded as new and its job sent', async () => {
  const { app, db, failSends } = await running();
  failSends(new Error('the queue is down'));
  expect((await deliver(app, 'pull_request', pullRequest())).statusCode).toBe(503);
  failSends(undefined);
  const redelivered = await deliver(app, 'pull_request', pullRequest());
  expect(redelivered.statusCode).toBe(202);
  expect(redelivered.json()).toEqual({ status: 'accepted' });
  expect((await deliveryRows(db)).map((row) => row.delivery_id)).toEqual([ID]);
  expect(await jobCount(db)).toBe(1);
});

test('the failure is logged once with its cause, and neither the response nor the log holds the payload or the job', async () => {
  const { app, logs, failSends } = await running();
  failSends(new Error('the queue is down'));
  const before = logs.lines().length;
  const response = await deliver(app, 'pull_request', pullRequest());
  const written = logs.lines().slice(before);
  const failed = written.filter((line) => line['msg'] === 'webhook.enqueue_failed');
  expect(failed).toHaveLength(1);
  expect(failed[0]).toMatchObject({ level: 50, err: { message: 'the queue is down' } });
  for (const text of [response.body, JSON.stringify(written)]) {
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain(String(FIXTURE_IDS.installation));
    expect(text).not.toContain(SECRET_CURRENT);
  }
});

test('a statement of the recording that fails is the same 503: the job is not sent for a row that was not written', async () => {
  const tenants = await tenantDatabase();
  await createJobsTable(tenants);
  const refusing: KyselyPlugin = {
    transformQuery: ({ node }) => {
      if (InsertQueryNode.is(node)) {
        throw new Error('the disk is full');
      }
      return node;
    },
    transformResult: ({ result }) => Promise.resolve(result),
  };
  const enqueuer = fakeEnqueuer();
  const { app } = await testApp({ env: ENV, db: tenants.withPlugin(refusing), enqueuer });
  const response = await deliver(app, 'pull_request', pullRequest());
  expect(response.statusCode).toBe(503);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('webhook_enqueue_failed');
  expect(enqueuer.calls).toEqual([]);
  expect(await deliveryRows(tenants)).toEqual([]);
});

test('a failed send for a delivery recorded before leaves the row and the job it had', async () => {
  const { app, db, failSends } = await running();
  await deliver(app, 'pull_request', pullRequest());
  const [before] = await deliveryRows(db);
  failSends(new Error('the queue is down'));
  expect((await deliver(app, 'pull_request', pullRequest())).statusCode).toBe(503);
  expect(await deliveryRows(db)).toEqual([before]);
  expect(await jobCount(db)).toBe(1);
});

test('a ping and an ignored delivery are answered while the queue is down: they send nothing', async () => {
  const { app, db, failSends } = await running();
  failSends(new Error('the queue is down'));
  expect((await deliver(app, 'ping', { zen: 'x' })).statusCode).toBe(200);
  expect((await deliver(app, 'push', { ref: 'x' })).statusCode).toBe(202);
  expect(
    (await deliver(app, 'pull_request', withValue(webhookFixture('pull_request'), 'action', 'labeled'))).statusCode,
  ).toBe(202);
  expect(await deliveryRows(db)).toEqual([]);
});

test('a server built without a queue refuses a delivery that starts a job with a 503 and keeps nothing', async () => {
  const db = await tenantDatabase();
  const { app } = await testApp({ env: ENV, db });
  const response = await deliver(app, 'pull_request', pullRequest());
  expect(response.statusCode).toBe(503);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('webhook_enqueue_failed');
  expect(await deliveryRows(db)).toEqual([]);
  expect((await deliver(app, 'ping', { zen: 'x' })).statusCode).toBe(200);
});
