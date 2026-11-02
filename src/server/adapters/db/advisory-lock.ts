// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql, type Transaction } from 'kysely';
import type { GithubId } from '../../../shared/github-id.ts';
import type { Database } from './schema.ts';

/**
 * Takes the transaction-level advisory lock of one installation (E05-S07): the transaction that holds it is the only one
 * working on that installation's admission and sync state, and the others wait until it commits or rolls back. The
 * lock is released by the database at the end of the transaction, so there is nothing to unlock and no way to leak it.
 * Taking it again in the same transaction is allowed and changes nothing, so a caller that already holds it can call
 * a function that takes it too. The key is a 64-bit hash of a namespaced text, so it cannot meet the migration lock or
 * the lock of another installation except by a hash collision, which only makes two installations take turns.
 */
export async function lockInstallation(trx: Transaction<Database>, githubInstallationId: GithubId): Promise<void> {
  const name = `installation:${githubInstallationId}`;
  await sql`select pg_advisory_xact_lock(hashtextextended(${name}, 0))`.execute(trx);
}
