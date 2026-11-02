// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import { POLICY_CHANGE_WINDOW_SECONDS, policyChangeDedupeKey } from '../../domain/repository-jobs.ts';
import { SWEEP_EVALUATION_WINDOW_SECONDS } from '../../domain/sweep.ts';
import type { SweepContext, SweepPorts } from './sweep-ports.ts';

// How a sweep asks for an evaluation (E07-S08, E07-S09): one `evaluate-pr` job per pull request, under a dedupe window per
// pull request, so a sweep that meets a pull request whose job is still waiting, running or retrying does not queue it again,
// and a pull request that keeps failing costs one job per window and not one per sweep. The scheduled sweep (trigger
// `sweep`, a window of five minutes) and the sweep of a repository whose policy changed (trigger `policy_change`, a window of
// one minute) differ in nothing else.

/** How one kind of sweep names its sends: why the evaluation exists, and the keys that make the sends idempotent and throttled. */
export interface EvaluationRequest {
  readonly trigger: 'sweep' | 'policy_change';
  /** Names the send of one pull request by the run `jobId`, so a retry of the run finds its own jobs. */
  readonly idempotencyKey: (jobId: string, githubRepoId: GithubId, prNumber: number) => string;
  /** The key of the dedupe window of one pull request. */
  readonly dedupeKey: (githubRepoId: GithubId, prNumber: number) => string;
  readonly windowSeconds: number;
}

/** The scheduled sweep (E07-S08): a window of five minutes per pull request. */
export const SWEEP_REQUEST: EvaluationRequest = {
  trigger: 'sweep',
  idempotencyKey: (jobId, githubRepoId, prNumber) => `sweep:${jobId}:${String(githubRepoId)}:${String(prNumber)}`,
  dedupeKey: (githubRepoId, prNumber) => `sweep:${String(githubRepoId)}:${String(prNumber)}`,
  windowSeconds: SWEEP_EVALUATION_WINDOW_SECONDS,
};

/** The sweep of a repository whose policy changed (E07-S09): a window of one minute per pull request. */
export const POLICY_CHANGE_REQUEST: EvaluationRequest = {
  trigger: 'policy_change',
  idempotencyKey: (jobId, githubRepoId, prNumber) =>
    `sweep-repository:${jobId}:${String(githubRepoId)}:${String(prNumber)}`,
  dedupeKey: policyChangeDedupeKey,
  windowSeconds: POLICY_CHANGE_WINDOW_SECONDS,
};

/** How the sends of one call ended. */
export interface SendCounts {
  readonly queued: number;
  readonly alreadyQueued: number;
  readonly deduplicated: number;
}

/** The pull requests of one repository to send an evaluation for. */
export interface EvaluationTarget {
  readonly githubInstallationId: GithubId;
  readonly githubRepoId: GithubId;
  readonly prNumbers: readonly number[];
}

/**
 * Sends an `evaluate-pr` job for each pull request of `target` as `request` says, in one transaction. The idempotency key names
 * the run, the repository and the pull request, so a retry of the job that makes the sends finds its own jobs.
 */
export async function enqueueEvaluations(
  ports: Pick<SweepPorts, 'db'>,
  context: Pick<SweepContext, 'enqueuer' | 'jobId'>,
  target: EvaluationTarget,
  request: EvaluationRequest,
): Promise<SendCounts> {
  const counts = { queued: 0, alreadyQueued: 0, deduplicated: 0 };
  const { githubInstallationId, githubRepoId, prNumbers } = target;
  if (prNumbers.length === 0) {
    return counts;
  }
  await ports.db.transaction().execute(async (tx) => {
    for (const prNumber of prNumbers) {
      const outcome = await context.enqueuer.enqueue(
        tx,
        { type: 'evaluate-pr', githubInstallationId, githubRepoId, prNumber, trigger: request.trigger },
        {
          idempotencyKey: request.idempotencyKey(context.jobId, githubRepoId, prNumber),
          dedupeKey: request.dedupeKey(githubRepoId, prNumber),
          dedupeWindowSeconds: request.windowSeconds,
        },
      );
      if (outcome === 'queued') {
        counts.queued += 1;
      } else if (outcome === 'already_queued') {
        counts.alreadyQueued += 1;
      } else {
        counts.deduplicated += 1;
      }
    }
  });
  return counts;
}
