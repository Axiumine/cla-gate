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
   * back and is thrown: there is never a row without its job.
   */
  record(subject: DeliverySubject, job: Job): Promise<DeliveryOutcome>;
  /** `markDeliveryProcessed` on this database, for the job layer (E07-S03) to call when the delivery's job completes. */
  markDeliveryProcessed(deliveryId: string): Promise<void>;
}

export interface WebhookDeliveriesOptions {
  readonly db: Kysely<Database>;
  readonly enqueuer: JobEnqueuer;
}

async function recordInTransaction(
  trx: Transaction<Database>,
  enqueuer: JobEnqueuer,
  subject: DeliverySubject,
  job: Job,
): Promise<DeliveryOutcome> {
  const isNew = await insertDelivery(trx, subject);
  if (!isNew && (await isProcessed(trx, subject.deliveryId))) {
    return 'duplicate';
  }
  const sent = await enqueuer.enqueue(trx, job, { idempotencyKey: subject.deliveryId });
  if (sent === 'queued') {
    return 'accepted';
  }
  await markDeliveryProcessed(trx, subject.deliveryId);
  return isNew ? 'accepted' : 'duplicate';
}

export function createWebhookDeliveries(options: WebhookDeliveriesOptions): WebhookDeliveries {
  const { db, enqueuer } = options;
  return {
    record: (subject, job) => db.transaction().execute((trx) => recordInTransaction(trx, enqueuer, subject, job)),
    markDeliveryProcessed: (deliveryId) => markDeliveryProcessed(db, deliveryId),
  };
}
