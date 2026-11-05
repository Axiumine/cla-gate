// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';

// The statement that records a per-commit override (E15-S05). It names the installation of the tenant in the row it writes, and the
// composite foreign key `(repository_id, installation_id)` of migration 001 refuses a repository of another tenant behind that. The
// unique key `(repository_id, commit_sha)` is what makes a commit overridden once per repository, so the same commit can carry an
// override in the repositories of two tenants (or of one) independently.

/** An override to store: the commit is a lower-case full SHA and the reason is already cleaned. */
export interface NewCommitOverrideRow {
  /** `repositories.id`. */
  readonly repositoryId: number;
  readonly commitSha: string;
  readonly reason: string;
  /** `users.id` of the person who records it. */
  readonly createdBy: number;
}

/** The part of the stored row that the database decides. */
interface StoredCommitOverride {
  readonly id: number;
  readonly createdAt: Date;
}

/**
 * Stores the override unless the repository has one for the commit already. Two simultaneous requests for one commit store it
 * once: the second waits for the first to commit and finds it.
 * @returns the id and the time of the new row, or undefined when the commit is overridden already.
 */
export async function insertCommitOverride(
  trx: Transaction<Database>,
  scope: TenantScope,
  row: NewCommitOverrideRow,
): Promise<StoredCommitOverride | undefined> {
  const stored = await trx
    .insertInto('commit_overrides')
    .values({
      installation_id: scope.installationId,
      repository_id: row.repositoryId,
      commit_sha: row.commitSha,
      reason: row.reason,
      created_by: row.createdBy,
    })
    .onConflict((conflict) => conflict.columns(['repository_id', 'commit_sha']).doNothing())
    .returning(['id', 'created_at'])
    .executeTakeFirst();
  return stored === undefined ? undefined : { id: stored.id, createdAt: stored.created_at };
}
