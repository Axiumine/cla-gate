// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';
import { deleteBatch, type RetentionTarget } from './retention-queries.ts';

// The loop of one table of the retention sweep (E22-S04): batch after batch, each in a transaction of its own.

/** Everything one table's batches need: the instant that decides which rows are due, and how many rows a batch deletes. */
export interface Drain {
  readonly cutoff: Date;
  readonly batchSize: number;
  readonly signal: AbortSignal | undefined;
}

/**
 * Deletes the due rows of one table in batches until a batch deletes fewer than `batchSize`, each batch in a transaction of its
 * own, and reports every batch to `onBatch` as it commits. The cutoff does not move during a run and a batch only takes rows
 * strictly older than it, so the set is finite and the loop ends; a second run right after the first finds nothing.
 */
export async function drain(
  db: Kysely<Database>,
  target: RetentionTarget,
  options: Drain,
  onBatch: (deleted: number) => void,
): Promise<void> {
  let deleted: number;
  do {
    options.signal?.throwIfAborted();
    deleted = await db.transaction().execute((trx) => deleteBatch(trx, target, options.cutoff, options.batchSize));
    onBatch(deleted);
  } while (deleted >= options.batchSize);
}
