// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import { deliveryIdSchema } from '../domain/delivery-id.ts';
import type { Job } from '../domain/jobs.ts';
import { createJobsTable, deliveryRows, fakeEnqueuer, jobCount } from './jobs-fixture/test-support.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import { countingDatabase } from './tenant-fixture/test-support.ts';
import { createWebhookDeliveries } from './webhook-deliveries.ts';

// The deadline of the recording (E06-S07): once the signal has aborted no statement or send starts, and the transaction
// rolls back, so a row never outlives the deadline without its job.

const ID = deliveryIdSchema.parse('5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c');
const SUBJECT = { deliveryId: ID, event: 'installation', action: 'created' };
const SYNC: Job = { type: 'sync-installation', githubInstallationId: parseGithubId(31_001), deliveryId: ID };

async function world() {
  const { db } = await migratedTestDatabase();
  await createJobsTable(db);
  return { db, counted: countingDatabase(db) };
}

/** A send that runs on the transaction like any other and then lets the deadline pass: the abort lands while it is in flight. */
function abortingAfterSend(controller: AbortController, outcome: 'queued' | 'deduplicated'): JobEnqueuer {
  const inner = fakeEnqueuer();
  return {
    async enqueue(tx, job, options) {
      await inner.enqueue(tx, job, options);
      controller.abort();
      return outcome;
    },
  };
}

test('a signal that never aborts changes nothing: the delivery is recorded and its job sent', async () => {
  const { db } = await world();
  const deliveries = createWebhookDeliveries({ db, enqueuer: fakeEnqueuer() });
  expect(await deliveries.record(SUBJECT, SYNC, new AbortController().signal)).toBe('accepted');
  expect(await deliveryRows(db)).toHaveLength(1);
  expect(await jobCount(db)).toBe(1);
});

test('a signal that has aborted before the recording starts sends nothing and records nothing', async () => {
  const { db } = await world();
  const enqueuer = fakeEnqueuer();
  const controller = new AbortController();
  controller.abort();
  const deliveries = createWebhookDeliveries({ db, enqueuer });
  await expect(deliveries.record(SUBJECT, SYNC, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(enqueuer.calls).toEqual([]);
  expect(await deliveryRows(db)).toEqual([]);
});

test('a deadline that passes while the send is in flight rolls the transaction back: neither row nor job', async () => {
  const { db } = await world();
  const controller = new AbortController();
  const deliveries = createWebhookDeliveries({ db, enqueuer: abortingAfterSend(controller, 'queued') });
  await expect(deliveries.record(SUBJECT, SYNC, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(await deliveryRows(db)).toEqual([]);
  expect(await jobCount(db)).toBe(0);
});

test('no statement starts after the deadline: a deduplicated send is not followed by the update that marks it processed', async () => {
  const { db, counted } = await world();
  const controller = new AbortController();
  const deliveries = createWebhookDeliveries({
    db: counted.db,
    enqueuer: abortingAfterSend(controller, 'deduplicated'),
  });
  await expect(deliveries.record(SUBJECT, SYNC, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  // The insert and the send's own insert: nothing else was issued on the connection once the signal had aborted.
  expect(counted.statements).toEqual(['InsertQueryNode', 'RawNode']);
  expect(await deliveryRows(db)).toEqual([]);
});
