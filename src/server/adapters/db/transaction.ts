// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, Transaction } from 'kysely';
import type { Database } from './schema.ts';

/** Whether `db` is a transaction already; the guard keeps the narrowed type `Transaction<Database>` and not `Transaction<any>`. */
function isTransaction(db: Kysely<Database>): db is Transaction<Database> {
  return db instanceof Transaction;
}

/**
 * Runs `work` in the caller's transaction when `db` already is one, else in a transaction of its own (E05-S06). Kysely
 * refuses to open a transaction inside a transaction, so a function that must be atomic whether or not its caller is
 * already in one starts here. The transaction commits when `work` resolves and rolls back when it throws.
 */
export function withTransaction<T>(db: Kysely<Database>, work: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
  return isTransaction(db) ? work(db) : db.transaction().execute(work);
}
