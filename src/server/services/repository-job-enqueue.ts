// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import { type SweepRepositoryReason, sweepRepositoryCoalesceKey } from '../domain/repository-jobs.ts';
import type { EnqueueOutcome, JobEnqueuer } from './ports/jobs.ts';

// How a change of policy asks for work on a repository (E07-S09). The callers (E12, E14, E15) send these jobs in the transaction
// that records the change, so the change and the job commit or roll back together; they pick no key and no window of their own.
// The handlers of `finalise-repository` and `finalise-check` are E14-S04's, and until they are registered the queues keep the jobs.

/** The repository a job is for, and the key that names the send. */
export interface RepositoryJobTarget {
  readonly githubInstallationId: GithubId;
  readonly githubRepoId: GithubId;
  /**
   * Names the send: while a job sent under the same key is alive another send under it creates nothing, so a caller that is
   * retried sends the same key, and a new change sends a new one (the id of its audit row, for instance).
   */
  readonly idempotencyKey: string;
}

/**
 * Asks for the open pull requests of a repository to be evaluated again because of `reason`. The send is coalesced per
 * repository (`sweep-repository:${githubRepoId}`): while a run waits for a worker, further edits send nothing, because that run
 * reads the policy when it starts and so covers them. `deduplicated` therefore means that a run is going to read the change, not
 * that it is lost. A run that is already going, or is over, does not count: it may have read the policy before this change, so
 * the send queues a new run.
 */
export function enqueueSweepRepository(
  tx: Transaction<Database>,
  enqueuer: JobEnqueuer,
  target: RepositoryJobTarget & { readonly reason: SweepRepositoryReason },
): Promise<EnqueueOutcome> {
  const { githubInstallationId, githubRepoId, reason, idempotencyKey } = target;
  return enqueuer.enqueue(
    tx,
    { type: 'sweep-repository', githubInstallationId, githubRepoId, reason },
    { idempotencyKey, coalesceKey: sweepRepositoryCoalesceKey(githubRepoId) },
  );
}

/**
 * Asks for the pending checks of a repository whose enforcement was turned off to be completed. The queue runs one at a time per
 * repository, and there is no window: turning enforcement off, on and off again is three changes, and each is finalised.
 */
export function enqueueFinaliseRepository(
  tx: Transaction<Database>,
  enqueuer: JobEnqueuer,
  target: RepositoryJobTarget,
): Promise<EnqueueOutcome> {
  const { githubInstallationId, githubRepoId, idempotencyKey } = target;
  return enqueuer.enqueue(tx, { type: 'finalise-repository', githubInstallationId, githubRepoId }, { idempotencyKey });
}

/**
 * Asks for the check of one pull request to be completed. The queue serialises the finalisations of one pull request under the
 * key `${githubRepoId}:${prNumber}` of `evaluate-pr`, but in a queue of their own (see `QUEUE_DEFINITIONS`).
 */
export function enqueueFinaliseCheck(
  tx: Transaction<Database>,
  enqueuer: JobEnqueuer,
  target: RepositoryJobTarget & { readonly prNumber: number },
): Promise<EnqueueOutcome> {
  const { githubInstallationId, githubRepoId, prNumber, idempotencyKey } = target;
  return enqueuer.enqueue(
    tx,
    { type: 'finalise-check', githubInstallationId, githubRepoId, prNumber },
    { idempotencyKey },
  );
}
