// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { GithubId } from '../../../shared/github-id.ts';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import type { EnqueueOptions, JobEnqueuer } from '../ports/jobs.ts';
import type { RecheckPorts } from './recheck-ports.ts';

// How a manual re-evaluation is sent (E07-S07): one `evaluate-pr` job per pull request, rate limited per pull request. The
// command costs GitHub API budget (an evaluation reads the pull request, its commits and the organisation), and anyone who
// can comment can give it, so a pull request takes one in a window and the rest are dropped without a reply.

/** Seconds in which a pull request takes one manual re-evaluation: a second request inside the window is dropped. */
const RECHECK_WINDOW_SECONDS = 60;

/** The most pull requests one re-run of a Check Run starts an evaluation for. A commit is the head of a handful of them at most. */
export const MAX_RERUN_PULL_REQUESTS = 20;

/** One evaluation to send. */
export interface Rerun {
  readonly job: EnvelopeOf<'evaluate-pr'>;
  /** Names the send, so that a retry of the job that makes it does not queue the evaluation twice. */
  readonly idempotencyKey: string;
}

/** The `evaluate-pr` job of `prNumber`: the ids and why it exists, and no delivery (the delivery belongs to the job that sends it). */
export function rerunOf(
  repository: { readonly githubInstallationId: GithubId; readonly githubRepoId: GithubId },
  prNumber: number,
  trigger: 'recheck' | 'check_rerequested',
  idempotencyKey: string,
): Rerun {
  const { githubInstallationId, githubRepoId } = repository;
  return { job: { type: 'evaluate-pr', githubInstallationId, githubRepoId, prNumber, trigger }, idempotencyKey };
}

/**
 * The send options of a re-run. Every way of asking for one (a `/recheck` comment, the Re-run button of a check) shares the
 * dedupe key of the pull request, so the limit is per pull request and not per way.
 */
function optionsOf({ job, idempotencyKey }: Rerun): EnqueueOptions {
  return {
    idempotencyKey,
    dedupeKey: `recheck:${job.githubRepoId}:${job.prNumber}`,
    dedupeWindowSeconds: RECHECK_WINDOW_SECONDS,
  };
}

/**
 * Sends the evaluations in one transaction, so that all of them are queued or none is. A send dropped by the window is
 * logged (`recheck.rate_limited`, the pull request number) and nothing else: there is no reply.
 * @returns `rate_limited` when every send was dropped, `enqueued` otherwise (a job already queued under the key counts: it
 * will do the evaluation).
 */
export async function enqueueReruns(
  ports: Pick<RecheckPorts, 'db'>,
  enqueuer: JobEnqueuer,
  logger: Logger,
  reruns: readonly Rerun[],
): Promise<'enqueued' | 'rate_limited'> {
  const dropped = await ports.db.transaction().execute(async (tx) => {
    const refused: Rerun[] = [];
    for (const rerun of reruns) {
      if ((await enqueuer.enqueue(tx, rerun.job, optionsOf(rerun))) === 'deduplicated') {
        refused.push(rerun);
      }
    }
    return refused;
  });
  for (const { job } of dropped) {
    logger.info({ prNumber: job.prNumber }, 'recheck.rate_limited');
  }
  return dropped.length === reruns.length ? 'rate_limited' : 'enqueued';
}
