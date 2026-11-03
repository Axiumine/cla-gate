// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import { evaluationCoalesceKey } from '../../domain/sweep.ts';
import type { SweepContext, SweepPorts } from './sweep-ports.ts';

// How a sweep asks for an evaluation (E07-S08, E07-S09): one `evaluate-pr` job per pull request, coalesced per pull request, so a
// sweep that meets a pull request whose job is still waiting (or retrying) does not queue it again: that job reads the pull request
// and the policy when it runs. A job that is already running does not stop the send, because it may have read the policy before
// the change that asks for the sweep. The scheduled sweep (trigger `sweep`) and the sweep of a repository whose policy changed
// (trigger `policy_change`) differ in the trigger and the name of the send, and nothing else.

/** How one kind of sweep names its sends: why the evaluation exists, and the key that makes each send idempotent. */
export interface EvaluationRequest {
  readonly trigger: 'sweep' | 'policy_change';
  /** Names the send of one pull request by the run `jobId`, so a retry of the run finds its own jobs. */
  readonly idempotencyKey: (jobId: string, githubRepoId: GithubId, prNumber: number) => string;
}

/** The scheduled sweep (E07-S08). */
export const SWEEP_REQUEST: EvaluationRequest = {
  trigger: 'sweep',
  idempotencyKey: (jobId, githubRepoId, prNumber) => `sweep:${jobId}:${String(githubRepoId)}:${String(prNumber)}`,
};

/** The sweep of a repository whose policy changed (E07-S09). */
export const POLICY_CHANGE_REQUEST: EvaluationRequest = {
  trigger: 'policy_change',
  idempotencyKey: (jobId, githubRepoId, prNumber) =>
    `sweep-repository:${jobId}:${String(githubRepoId)}:${String(prNumber)}`,
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
          coalesceKey: evaluationCoalesceKey(githubRepoId, prNumber),
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
