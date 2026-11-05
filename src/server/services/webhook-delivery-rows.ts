// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql, type Transaction } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import { type DeliveryId, deliveryIdSchema } from '../domain/delivery-id.ts';

// The three statements the intake runs on `webhook_deliveries` (E06-S06). Every one is a parameterised Kysely statement,
// and the delivery id in it is a parsed `DeliveryId` (a UUID in lower case), never the header as it came in.

/** The three facts of a delivery that are kept. The id is the parsed header, never the header as it came in. */
export interface DeliverySubject {
  readonly deliveryId: DeliveryId;
  /** `X-GitHub-Event`: lower-case letters and underscores, 64 characters at most. */
  readonly event: string;
  /** The `action` of the payload (bounded by its schema), or `null` for an event that has none. */
  readonly action: string | null;
}

/** Inserts the delivery; `true` when this call created the row, `false` when it was already there. */
export async function insertDelivery(trx: Transaction<Database>, subject: DeliverySubject): Promise<boolean> {
  const inserted = await trx
    .insertInto('webhook_deliveries')
    .values({ delivery_id: subject.deliveryId, event: subject.event, action: subject.action })
    .onConflict((conflict) => conflict.column('delivery_id').doNothing())
    .returning('delivery_id')
    .executeTakeFirst();
  return inserted !== undefined;
}

/**
 * Whether a job already finished the recorded delivery. The row is locked, so two requests for one delivery take turns. A row
 * that is gone is not processed: the retention sweep (E22-S04) may have deleted an old one between the insert that met it and
 * this read, and the delivery is then handled as the new one it has become.
 */
export async function isProcessed(trx: Transaction<Database>, deliveryId: DeliveryId): Promise<boolean> {
  const row = await trx
    .selectFrom('webhook_deliveries')
    .select('processed_at')
    .where('delivery_id', '=', deliveryId)
    .forUpdate()
    .executeTakeFirst();
  return row !== undefined && row.processed_at !== null;
}

/**
 * Sets `processed_at = now()` of the delivery, only where it is still null: the first call decides when, every later
 * one changes nothing, and a delivery that is not recorded is left alone. `deliveryId` is parsed as the UUID it is, so
 * the id of a job (a string) matches the row the webhook wrote.
 */
export async function markDeliveryProcessed(db: Kysely<Database>, deliveryId: string): Promise<void> {
  await db
    .updateTable('webhook_deliveries')
    .set({ processed_at: sql`now()` })
    .where('delivery_id', '=', deliveryIdSchema.parse(deliveryId))
    .where('processed_at', 'is', null)
    .execute();
}
