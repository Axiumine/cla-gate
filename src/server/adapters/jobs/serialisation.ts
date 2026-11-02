// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Job } from '../../domain/jobs.ts';

// The serialisation key of a job (E07-S02): the jobs of one queue that share it never run at the same time, and a job
// with another key runs in parallel. It is pg-boss's `singletonKey`, which the queues whose policy is `singleton`
// (`QUEUE_DEFINITIONS`) read.

/**
 * `${githubRepoId}:${prNumber}` for an `evaluate-pr` job, so two evaluations of one pull request never overlap and two
 * pull requests do (a pull request number is unique per repository only, hence both ids). `undefined` for a job of a
 * type that is not serialised. E07-S09 adds `finalise-check`, keyed the same way.
 */
export function serialisationKey(job: Job): string | undefined {
  return job.type === 'evaluate-pr' ? `${job.githubRepoId}:${job.prNumber}` : undefined;
}
