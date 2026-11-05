// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { QueuedJob } from '../../services/ports/jobs.ts';

// The serialisation key of a job (E07-S02): the jobs of one queue that share it never run at the same time, and a job
// with another key runs in parallel. It is pg-boss's `singletonKey`, which the queues whose policy is `singleton`
// (`QUEUE_DEFINITIONS`) read.

/**
 * The key of a job whose queue serialises, or `undefined` for a type that is not serialised.
 * - `${githubRepoId}:${prNumber}` for `evaluate-pr` and for `finalise-check` (E07-S09): the same key, so two evaluations of
 *   one pull request never overlap, nor do two finalisations of it, and two pull requests do (a pull request number is
 *   unique per repository only, hence both ids). The two are in different queues, and a pg-boss policy holds within one
 *   queue only: a finalisation does not wait for an evaluation that is in flight (see `finalise-check` in `queues.ts`).
 * - `${githubRepoId}:${headSha}` for `evaluate-merge-group` (E22-S01): the runs for one group never overlap (a head SHA is unique per
 *   repository, a group has no pull request number of its own).
 * - `${githubRepoId}` for `finalise-repository` (E07-S09): the finalisations of one repository never overlap.
 */
export function serialisationKey(job: QueuedJob): string | undefined {
  if (job.type === 'evaluate-pr' || job.type === 'finalise-check') {
    return `${job.githubRepoId}:${job.prNumber}`;
  }
  if (job.type === 'evaluate-merge-group') {
    return `${job.githubRepoId}:${job.headSha}`;
  }
  return job.type === 'finalise-repository' ? `${job.githubRepoId}` : undefined;
}
