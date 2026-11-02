// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import { withTransaction } from '../adapters/db/transaction.ts';
import { batches, type RepositoryRow } from './repository-rows.ts';

// Every function takes the installation id (`installations.id`) and puts it in the WHERE clause of every statement it
// runs, so a call made for one tenant can neither read nor change the rows of another (E05-S06). The one place where
// two tenants meet is the partial unique index: a GitHub repository is active under at most one installation.

/**
 * Marks the installation's active repositories among `githubRepoIds` as removed at `removedAt`; the rows stay, with their
 * documents, signatures and `enabled` flag, and an id that is unknown, already removed or stored under another
 * installation is ignored. Runs in the caller's transaction, or in one of its own.
 * @returns the ids that changed from active to removed, for the audit rows of the caller.
 */
export function markRepositoriesRemoved(
  db: Kysely<Database>,
  installationId: number,
  githubRepoIds: readonly GithubId[],
  removedAt: Date,
): Promise<GithubId[]> {
  return withTransaction(db, async (trx) => {
    const removed: GithubId[] = [];
    for (const batch of batches(githubRepoIds)) {
      const rows = await trx
        .updateTable('repositories')
        .set({ removed_at: removedAt, updated_at: sql`now()` })
        .where('installation_id', '=', installationId)
        .where('github_repo_id', 'in', batch)
        .where('removed_at', 'is', null)
        .returning('github_repo_id')
        .execute();
      removed.push(...rows.map((row) => parseGithubId(row.github_repo_id)));
    }
    return removed;
  });
}

/** The repository stored for this installation that is not removed, or `null`: at most one row, never another tenant's. */
export async function findActiveRepositoryByGithubId(
  db: Kysely<Database>,
  installationId: number,
  githubRepoId: GithubId,
): Promise<RepositoryRow | null> {
  const row = await db
    .selectFrom('repositories')
    .selectAll()
    .where('installation_id', '=', installationId)
    .where('github_repo_id', '=', githubRepoId)
    .where('removed_at', 'is', null)
    .executeTakeFirst();
  return row ?? null;
}
