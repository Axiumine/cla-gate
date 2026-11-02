// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { PendingJobs } from '../ports/jobs.ts';
import { cancelRunning } from './cancel-running.ts';
import { headShasToCancel } from './close-heads.ts';
import type { Closed, ClosePrPorts } from './close-pr-ports.ts';
import { evaluationsOfPullRequest } from './close-rows.ts';

// What a closed pull request leaves behind, and how it is cleared (E07-S06): the jobs that wait for it, and the evaluations
// that are in progress, whose Check Runs would hang if nobody ended them. The reaper of the sweep (E07-S08) calls it for a
// pull request it finds closed.

/** What was cleared. */
export interface Pruned {
  /** Queued and retrying jobs that were cancelled. */
  readonly jobs: number;
  /** Evaluations that were in progress and are now cancelled (one that got its verdict in the meantime is not counted). */
  readonly evaluations: number;
}

/**
 * Clears the pending work of a closed pull request, merged or not:
 * - cancels its queued and retrying `evaluate-pr`, `evaluate-head-sha` and `recheck-comment` jobs through the queue's API;
 *   the jobs that run are left to end themselves. An `evaluate-head-sha` job is found by head SHA, except for a head SHA that
 *   another pull request of the repository was evaluated at (see {@link headShasToCancel});
 * - for each evaluation still `in_progress`, reports the Check Run `cancelled` and sets the row to `cancelled` (see
 *   {@link cancelRunning}); evaluations with a final result are untouched.
 *
 * Safe to run twice and for a pull request that has no rows.
 * @throws what the queue, the database or the reporter throws: the job fails and the queue retries it.
 */
export async function prunePullRequest(ports: ClosePrPorts, pending: PendingJobs, closed: Closed): Promise<Pruned> {
  const { installation, repository } = closed.resolved.tenant;
  const scope = { installationId: installation.id, repositoryId: repository.id };
  const evaluations = await evaluationsOfPullRequest(ports.db, scope, closed.prNumber);
  const jobs = await pending.cancelForPullRequest({
    githubInstallationId: closed.githubInstallationId,
    githubRepoId: closed.githubRepoId,
    prNumber: closed.prNumber,
    headShas: await headShasToCancel(ports.db, scope, {
      prNumber: closed.prNumber,
      evaluations,
      currentHeadSha: closed.currentHeadSha,
    }),
  });
  return { jobs, evaluations: await cancelRunning(ports, installation.id, closed, evaluations) };
}
