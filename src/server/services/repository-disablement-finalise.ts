// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import type { LockedRepository } from './repository-document-lock-queries.ts';
import { readRepositoryChangedAt } from './repository-document-queries.ts';
import { enqueueFinaliseRepository } from './repository-job-enqueue.ts';

// The job that follows turning enforcement off for a repository (E14-S04), sent in the transaction that turned it off.

/**
 * Sends the `finalise-repository` job that completes the checks a repository `setRepositoryEnabled` has just turned off in `trx`
 * would leave pending. The job is named by the time of that change (the `updated_at` it wrote), so turning enforcement off, on and
 * off again is three changes and each off is finalised, while a retry of the same change sends the same key.
 */
export async function sendDisableFinalise(
  trx: Transaction<Database>,
  scope: TenantScope,
  enqueuer: JobEnqueuer,
  repository: LockedRepository,
): Promise<void> {
  const changedAt = await readRepositoryChangedAt(trx, scope, repository.id);
  await enqueueFinaliseRepository(trx, enqueuer, {
    githubInstallationId: repository.githubInstallationId,
    githubRepoId: repository.githubRepoId,
    idempotencyKey: `finalise-repository:${String(repository.githubRepoId)}:${String(changedAt.getTime())}`,
  });
}
