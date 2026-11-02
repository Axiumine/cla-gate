// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import { SWEEP_EVALUATION_WINDOW_SECONDS } from '../../domain/sweep.ts';
import type { SweepContext, SweepPorts } from './sweep-ports.ts';

// How the sweep asks for an evaluation (E07-S08): one `evaluate-pr` job per pull request with the trigger `sweep`, under a
// dedupe window of five minutes per pull request, so a sweep that meets a pull request whose job is still waiting, running or
// retrying does not queue it again, and a pull request that keeps failing costs one job per window and not one per sweep.

/** How the sends of one call ended. */
export interface SendCounts {
  readonly queued: number;
  readonly alreadyQueued: number;
  readonly deduplicated: number;
}

/**
 * Sends an `evaluate-pr` job for each of `prNumbers` of the repository, in one transaction. The idempotency key names the
 * run, the repository and the pull request, so a retry of the job that makes the sends finds its own jobs.
 */
export async function enqueueEvaluations(
  ports: Pick<SweepPorts, 'db'>,
  context: SweepContext,
  repository: { readonly githubInstallationId: GithubId; readonly githubRepoId: GithubId },
  prNumbers: readonly number[],
): Promise<SendCounts> {
  const counts = { queued: 0, alreadyQueued: 0, deduplicated: 0 };
  if (prNumbers.length === 0) {
    return counts;
  }
  const { githubInstallationId, githubRepoId } = repository;
  await ports.db.transaction().execute(async (tx) => {
    for (const prNumber of prNumbers) {
      const outcome = await context.enqueuer.enqueue(
        tx,
        { type: 'evaluate-pr', githubInstallationId, githubRepoId, prNumber, trigger: 'sweep' },
        {
          idempotencyKey: `sweep:${context.jobId}:${String(githubRepoId)}:${String(prNumber)}`,
          dedupeKey: `sweep:${String(githubRepoId)}:${String(prNumber)}`,
          dedupeWindowSeconds: SWEEP_EVALUATION_WINDOW_SECONDS,
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
