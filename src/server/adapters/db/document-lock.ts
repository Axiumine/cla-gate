// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql, type Transaction } from 'kysely';
import type { InstallationRowId } from './installation-row-id.ts';
import type { Database } from './schema.ts';

/**
 * Takes the transaction-level advisory lock that serialises the creation of documents in one installation (E12-S01): the
 * transaction that holds it counts the documents and inserts the new one before any other creator of the same tenant
 * counts, so the limit per installation cannot be passed by two simultaneous requests. The lock is released by the
 * database at the end of the transaction. The key is a 64-bit hash of a namespaced text, distinct from the lock of the
 * installation sync (`lockInstallation`), so creating a document never waits for a sync.
 */
export async function lockDocumentCreation(
  trx: Transaction<Database>,
  installationId: InstallationRowId,
): Promise<void> {
  const name = `cla_documents:${installationId}`;
  await sql`select pg_advisory_xact_lock(hashtextextended(${name}, 0))`.execute(trx);
}
