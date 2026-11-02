// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test, vi } from 'vitest';
import { unavailableResponseSchema } from '../shared/health.ts';
import { openPgliteDatabase } from './adapters/db/pglite.ts';
import { FIXTURE_IDS, webhookFixture } from './adapters/github/webhook-fixture/test-support.ts';
import { deliveryHeaders, postDelivery, SECRET_CURRENT } from './adapters/http/test-support.ts';
import { createJobsTable, fakeEnqueuer, jobCount } from './services/jobs-fixture/test-support.ts';
import { tenantDatabase } from './services/tenant-fixture/test-support.ts';
import { fakeJobQueue, testApp } from './test-support.ts';

// The job queue in the app (E07-S01): `/readyz` follows it, closing the app stops it before the database, and the
// webhook intake sends through it.

const QUEUE_LOG = 'readiness check failed: the job queue is not ready';
const DATABASE_LOG = 'readiness check failed: the database did not answer';
const messages = (logs: Awaited<ReturnType<typeof testApp>>['logs']): unknown[] =>
  logs.lines().map((line) => line['msg']);

test('/readyz is ready while the database answers and the queue is ready', async () => {
  const { app } = await testApp({ jobQueue: fakeJobQueue() });
  expect((await app.inject('/readyz')).statusCode).toBe(200);
});

test('/readyz is 503 with the fixed body while the queue is not ready, and the log says which dependency it is', async () => {
  const queue = fakeJobQueue();
  queue.ready = false;
  const { app, logs } = await testApp({ jobQueue: queue });
  const response = await app.inject('/readyz');
  expect(response.statusCode).toBe(503);
  expect(unavailableResponseSchema.parse(response.json())).toEqual({ status: 'unavailable' });
  expect(messages(logs)).toContain(QUEUE_LOG);
  expect(messages(logs)).not.toContain(DATABASE_LOG);
});

test('/readyz is ready again once the queue is', async () => {
  const queue = fakeJobQueue();
  queue.ready = false;
  const { app } = await testApp({ jobQueue: queue });
  expect((await app.inject('/readyz')).statusCode).toBe(503);
  queue.ready = true;
  expect((await app.inject('/readyz')).statusCode).toBe(200);
});

test('/readyz is 503 when the queue cannot say, or does not answer in time', async () => {
  const failing = fakeJobQueue();
  failing.isReady = () => Promise.reject(new Error('read failed'));
  const hanging = fakeJobQueue();
  hanging.isReady = () => new Promise<boolean>(() => undefined);
  const first = await testApp({ jobQueue: failing });
  const second = await testApp({ jobQueue: hanging, readinessTimeoutMs: 50 });
  expect((await first.app.inject('/readyz')).statusCode).toBe(503);
  expect((await second.app.inject('/readyz')).statusCode).toBe(503);
});

test('/readyz logs both reasons when the database and the queue are down', async () => {
  const queue = fakeJobQueue();
  queue.ready = false;
  const db = await openPgliteDatabase();
  const { app, logs } = await testApp({ db, jobQueue: queue });
  await db.destroy();
  expect((await app.inject('/readyz')).statusCode).toBe(503);
  expect(messages(logs)).toEqual(expect.arrayContaining([DATABASE_LOG, QUEUE_LOG]));
});

test('closing the app stops the queue first and then destroys the database', async () => {
  const queue = fakeJobQueue();
  const stop = vi.spyOn(queue, 'stop');
  const { app, db } = await testApp({ jobQueue: queue });
  const destroy = vi.spyOn(db, 'destroy');
  await app.close();
  expect(stop).toHaveBeenCalledOnce();
  expect(destroy).toHaveBeenCalledOnce();
  expect(stop.mock.invocationCallOrder[0]).toBeLessThan(destroy.mock.invocationCallOrder[0] ?? 0);
});

test('a queue that fails to stop does not keep the database open', async () => {
  const queue = fakeJobQueue();
  queue.stop = () => Promise.reject(new Error('stop failed'));
  const { app, db } = await testApp({ jobQueue: queue });
  await expect(app.close()).rejects.toThrow('stop failed');
  await expect(sql`select 1`.execute(db)).rejects.toThrow('driver has already been destroyed');
});

/** The app on the database of the tenants, with a queue whose enqueuer is the fake one, and the delivery GitHub sends. */
async function deliverWith(options: { readonly explicit: boolean }) {
  const db = await tenantDatabase();
  await createJobsTable(db);
  const viaQueue = fakeEnqueuer();
  const explicit = fakeEnqueuer();
  const { app } = await testApp({
    db,
    env: { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT, GITHUB_APP_ID: String(FIXTURE_IDS.app) },
    jobQueue: fakeJobQueue(viaQueue),
    ...(options.explicit ? { enqueuer: explicit } : {}),
  });
  const text = JSON.stringify(webhookFixture('pull_request'));
  const response = await postDelivery(
    app,
    text,
    deliveryHeaders(text, { headers: { 'x-github-event': 'pull_request' } }),
  );
  return { response, viaQueue, explicit, db };
}

test('the webhook intake sends the job of a delivery through the queue of the app', async () => {
  const { response, viaQueue, db } = await deliverWith({ explicit: false });
  expect(response.statusCode).toBe(202);
  expect(viaQueue.calls).toHaveLength(1);
  expect(await jobCount(db)).toBe(1);
});

test('an enqueuer given to the app wins over the queue behind it', async () => {
  const { response, viaQueue, explicit } = await deliverWith({ explicit: true });
  expect(response.statusCode).toBe(202);
  expect(viaQueue.calls).toEqual([]);
  expect(explicit.calls).toHaveLength(1);
});
