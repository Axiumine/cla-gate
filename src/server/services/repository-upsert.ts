// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import { withTransaction } from '../adapters/db/transaction.ts';
import { classify, distinct } from './repository-plan.ts';
import { batches, type RepositoryChanges, type RepositorySnapshot } from './repository-rows.ts';
import { storedStates, writeChanged } from './repository-statements.ts';

/**
 * Stores the repositories GitHub lists for the installation. New ids are inserted with `enabled = false`; a stored id
 * gets its `full_name` refreshed, and a removed one is brought back (`removed_at` cleared); `enabled` and the attached
 * CLA document are never touched. Rows that already match what is listed are not written. Runs in the caller's
 * transaction, or in one of its own, in batches of `REPOSITORY_BATCH_SIZE`.
 * It does not serialise concurrent callers (the sync takes a per-installation lock, E05-S08): two that race may both
 * report the same id as added.
 * A repository that is active under another installation violates the partial unique index (`unique_violation`) and
 * changes nothing at all: moving a repository between tenants is the transfer rule of E05-S09, not an upsert.
 */
export function upsertRepositories(
  db: Kysely<Database>,
  installationId: number,
  repositories: readonly RepositorySnapshot[],
): Promise<RepositoryChanges> {
  return withTransaction(db, async (trx) => {
    const added: GithubId[] = [];
    const renamed: GithubId[] = [];
    for (const batch of batches(distinct(repositories))) {
      const plan = classify(batch, await storedStates(trx, installationId, batch));
      added.push(...plan.added);
      renamed.push(...plan.renamed);
      if (plan.changed.length > 0) {
        await writeChanged(trx, installationId, plan.changed);
      }
    }
    return { added, renamed };
  });
}
