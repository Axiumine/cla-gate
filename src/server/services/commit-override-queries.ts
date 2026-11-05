// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';

// The statements that record a per-commit override (E15-S05) and remove one (E15-S06). The insert names the installation of the tenant in
// the row it writes, and the composite foreign key `(repository_id, installation_id)` of migration 001 refuses a repository of another
// tenant behind that. The unique key `(repository_id, commit_sha)` is what makes a commit overridden once per repository, so the same
// commit can carry an override in the repositories of two tenants (or of one) independently; it holds the rows that exist, not the
// history (that is the audit log), so a commit whose override was removed can be overridden again. The delete names the installation
// and the repository next to the id, so an override of another tenant or of another repository is never found.

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

/** The override a removal took out, as the audit row and the re-evaluation need it. */
export interface RemovedCommitOverride {
  /** The full SHA, in lower case, the override was for. */
  readonly commitSha: string;
}

/**
 * Removes the override `overrideId` of the repository `repositoryId` of the tenant for good (`where id = $1 and repository_id = $2 and
 * installation_id = $3`; the runtime role holds `DELETE` on the table).
 * @returns the commit the override was for, or undefined when the repository of the tenant has no such override: another tenant's,
 * another repository's, an unknown one and one removed already (by a simultaneous call too) are the same answer.
 */
export async function deleteCommitOverride(
  trx: Transaction<Database>,
  scope: TenantScope,
  target: { readonly repositoryId: number; readonly overrideId: number },
): Promise<RemovedCommitOverride | undefined> {
  const removed = await trx
    .deleteFrom('commit_overrides')
    .where('id', '=', target.overrideId)
    .where('repository_id', '=', target.repositoryId)
    .where('installation_id', '=', scope.installationId)
    .returning('commit_sha')
    .executeTakeFirst();
  return removed === undefined ? undefined : { commitSha: removed.commit_sha };
}
