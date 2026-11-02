// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { StoredState } from './repository-plan.ts';
import type { RepositorySnapshot } from './repository-rows.ts';

// The two statements of one batch of an upsert: what is stored for the listed ids, and the write of those that changed.
// Both name the installation in their WHERE clause or their values, so they can only see and touch that tenant's rows.

/** The name and removal state of the installation's rows among `batch`, by GitHub repository id. */
export async function storedStates(
  trx: Kysely<Database>,
  installationId: number,
  batch: readonly RepositorySnapshot[],
): Promise<Map<number, StoredState>> {
  const rows = await trx
    .selectFrom('repositories')
    .select(['github_repo_id', 'full_name', 'removed_at'])
    .where('installation_id', '=', installationId)
    .where(
      'github_repo_id',
      'in',
      batch.map((repository) => repository.githubRepoId),
    )
    .execute();
  return new Map(rows.map((row) => [row.github_repo_id, row]));
}

/** Inserts the repositories as new rows with `enabled = false`, or refreshes the name of the stored row and clears its removal. */
export async function writeChanged(
  trx: Kysely<Database>,
  installationId: number,
  changed: readonly RepositorySnapshot[],
): Promise<void> {
  await trx
    .insertInto('repositories')
    .values(
      changed.map((repository) => ({
        installation_id: installationId,
        github_repo_id: repository.githubRepoId,
        full_name: repository.fullName,
        enabled: false,
      })),
    )
    .onConflict((conflict) =>
      conflict.columns(['installation_id', 'github_repo_id']).doUpdateSet((builder) => ({
        full_name: builder.ref('excluded.full_name'),
        removed_at: null,
        updated_at: sql`now()`,
      })),
    )
    .execute();
}
