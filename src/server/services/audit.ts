// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import { type AuditEntry, toAuditRow } from './audit-entry.ts';

export { type AuditEntry, AuditEntryInvalid } from './audit-entry.ts';

/**
 * Appends one audit row inside the caller's transaction (E04-S09). It takes a `Transaction` and not the database handle,
 * so the row commits with the mutation it records or not at all: the type system refuses the plain handle. There is no
 * update or delete here on purpose; the table is append-only (triggers) and so is this module.
 * @throws AuditEntryInvalid when the entry breaks the contract; nothing is written and the caller's transaction must fail.
 */
export async function appendAudit(trx: Transaction<Database>, entry: AuditEntry): Promise<void> {
  await trx.insertInto('audit_log').values(toAuditRow(entry)).execute();
}
