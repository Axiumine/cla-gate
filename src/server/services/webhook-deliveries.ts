// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { Job } from '../domain/jobs.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import { type DeliverySubject, insertDelivery, isProcessed, markDeliveryProcessed } from './webhook-delivery-rows.ts';

// Recording a webhook delivery and sending its job in one transaction (E06-S06). GitHub reuses `X-GitHub-Delivery` on a
// redelivery, so the delivery id is the idempotency key of the whole intake: a row never exists without its job, and a
// delivery whose job has not finished is sent again instead of being dropped as a duplicate. No payload is stored: the
// row holds the id, the event, the action and two times, and the job re-reads the rest from GitHub.

/**
 * What became of a delivery that starts a job: `accepted` when it was recorded now (or its earlier job is gone and a new
 * one was sent), `duplicate` when it was already recorded and nothing more is to be done.
 */
export type DeliveryOutcome = 'accepted' | 'duplicate';

export interface WebhookDeliveries {
  /**
   * In one transaction: inserts the delivery (`on conflict (delivery_id) do nothing`); for one already recorded, reads
   * and locks its row, and answers `duplicate` when a job already finished it; then sends `job` under the delivery id
   * as the idempotency key, so at most one live job exists per delivery. A send that is `deduplicated` leaves nobody to
   * finish the delivery, so it is marked processed in the same transaction. A failed statement or send rolls everything
   * back and is thrown: there is never a row without its job. With a `signal` (E06-S07), once it has aborted no further
   * statement or send starts and the transaction is rolled back, as soon as the one in flight has returned.
   */
  record(subject: DeliverySubject, job: Job, signal?: AbortSignal): Promise<DeliveryOutcome>;
  /** `markDeliveryProcessed` on this database, for the job layer (E07-S03) to call when the delivery's job completes. */
  markDeliveryProcessed(deliveryId: string): Promise<void>;
}

export interface WebhookDeliveriesOptions {
  readonly db: Kysely<Database>;
  readonly enqueuer: JobEnqueuer;
}

/**
 * One step of the recording. A step does not start once `signal` has aborted, and when it aborted during the step the
 * result is dropped: the error leaves the transaction, which rolls back. Nothing is issued on the connection after the
 * deadline, so a late statement can never run outside the transaction it belonged to.
 */
async function step<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
  signal?.throwIfAborted();
  const result = await run();
  signal?.throwIfAborted();
  return result;
}

async function recordInTransaction(
  trx: Transaction<Database>,
  subject: DeliverySubject,
  job: Job,
  context: { readonly enqueuer: JobEnqueuer; readonly signal: AbortSignal | undefined },
): Promise<DeliveryOutcome> {
  const { enqueuer, signal } = context;
  const isNew = await step(signal, () => insertDelivery(trx, subject));
  if (!isNew && (await step(signal, () => isProcessed(trx, subject.deliveryId)))) {
    return 'duplicate';
  }
  const sent = await step(signal, () => enqueuer.enqueue(trx, job, { idempotencyKey: subject.deliveryId }));
  if (sent === 'queued') {
    return 'accepted';
  }
  await step(signal, () => markDeliveryProcessed(trx, subject.deliveryId));
  return isNew ? 'accepted' : 'duplicate';
}

export function createWebhookDeliveries(options: WebhookDeliveriesOptions): WebhookDeliveries {
  const { db, enqueuer } = options;
  return {
    record: (subject, job, signal) =>
      db.transaction().execute((trx) => recordInTransaction(trx, subject, job, { enqueuer, signal })),
    markDeliveryProcessed: (deliveryId) => markDeliveryProcessed(db, deliveryId),
  };
}
