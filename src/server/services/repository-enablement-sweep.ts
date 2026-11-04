// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import type { LockedRepository } from './repository-document-lock-queries.ts';
import { readRepositoryChangedAt } from './repository-document-queries.ts';
import { enqueueSweepRepository } from './repository-job-enqueue.ts';

// The job that follows turning enforcement on for a repository (E14-S03), sent in the transaction that turned it on.

/**
 * Sends the `sweep-repository` job that evaluates the pull requests already open on a repository `setRepositoryEnabled` has just
 * turned on in `trx`. The send is named by the time of that change (the `updated_at` it wrote), so a later enable, after a
 * disable, is a send of its own, and the coalescing per repository still lets a run that has not started cover several.
 */
export async function sendEnableSweep(
  trx: Transaction<Database>,
  scope: TenantScope,
  enqueuer: JobEnqueuer,
  repository: LockedRepository,
): Promise<void> {
  const changedAt = await readRepositoryChangedAt(trx, scope, repository.id);
  await enqueueSweepRepository(trx, enqueuer, {
    githubInstallationId: repository.githubInstallationId,
    githubRepoId: repository.githubRepoId,
    reason: 'repository_enabled',
    idempotencyKey: `sweep-repository:repository_enabled:${String(repository.githubRepoId)}:${String(changedAt.getTime())}`,
  });
}
