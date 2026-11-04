// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import type { JobOutcome } from '../job-registry.ts';
import { isInstallationUnavailable } from '../ports/installation-unavailable.ts';
import { handOverRetry } from './enforcement-guard.ts';
import { evaluateOpen, evaluationKey } from './evaluate-open.ts';
import type { EvaluatePrContext, EvaluatePrPorts } from './evaluate-pr-ports.ts';
import { type EvaluationKey, findEvaluation, type StoredResult, setPullRequestState } from './evaluation-rows.ts';
import { loadPullRequest } from './evaluation-tenant.ts';

// The `evaluate-pr` job (E07-S04): the protocol around the pure engine. The job names a pull request by numeric ids and is
// told nothing else; everything it decides on is read now, from GitHub and from the database, in a fixed order:
//
//   1. the repository (its name may have changed), 2. the pull request, 3. the evaluation row in progress and the report that
//   it began, 4. the commits, 5. the policy facts, 6. the signatures, last, 7. the engine, 8. the pull request again.
//
// Between 2 and 3 a pull request that GitHub shows open has `pr_state = 'open'` set on every row it has (E15-S01): this is where a
// reopen is recorded, because the `reopened` delivery is routed here, and it comes before the idempotency rule so that a reopen
// that finds a final result for its head SHA still reopens the rows the close had marked.
//
// Step 8 decides whether the verdict may be written: a push or a close during the run discards it, because the Check Run is
// per head SHA and the push that moved the head sent a delivery of its own.

type Job = EnvelopeOf<'evaluate-pr'>;

const skipped = (logger: Logger, reason: string): JobOutcome => {
  logger.info({ reason }, 'evaluate_pr.skipped');
  return { outcome: `skipped:${reason}` };
};

/**
 * A final result: the verdict is written and the run is over. A `cancelled` row is not final: the pull request was closed
 * before the evaluation finished (E07-S06), and when it is reopened it is evaluated like any other.
 */
const isFinal = (result: StoredResult): boolean => result === 'success' || result === 'failure';

/**
 * The idempotency rule: a delivery of `pull_request` for a head SHA that already has a final result and a Check Run is
 * answered by what is there, so ten `edited` deliveries are one evaluation. Every other trigger asks for a fresh look, and so
 * does a retry: the run before it may have stored the verdict and died before the report went out.
 */
async function alreadyEvaluated(
  ports: EvaluatePrPorts,
  job: Job,
  context: EvaluatePrContext,
  key: EvaluationKey,
): Promise<boolean> {
  if (job.trigger !== 'pull_request' || context.attempt > 0) {
    return false;
  }
  const stored = await findEvaluation(ports.db, key);
  return stored !== null && isFinal(stored.result) && stored.checkRunId !== null;
}

async function run(ports: EvaluatePrPorts, job: Job, context: EvaluatePrContext): Promise<JobOutcome> {
  const { logger } = context;
  const loaded = await loadPullRequest(ports, job);
  if (typeof loaded === 'string') {
    if (loaded === 'repository_disabled') {
      await handOverRetry({ ports, job, context });
    }
    return skipped(logger, loaded);
  }
  const { resolved, pr } = loaded;
  if (pr?.state !== 'open') {
    return skipped(logger, pr === null ? 'pull_request_not_found' : 'pull_request_closed');
  }
  const key = evaluationKey(resolved.tenant, job, pr);
  await setPullRequestState(ports.db, key, pr.state);
  if (await alreadyEvaluated(ports, job, context, key)) {
    logger.info('evaluate_pr.unchanged');
    return { outcome: 'unchanged' };
  }
  return evaluateOpen({ ports, job, resolved, context }, pr);
}

/**
 * Evaluates one pull request: the protocol above, with the facts of now.
 * - Ends `skipped:<reason>` with no GitHub call for a repository that is not the installation's, an installation or
 *   repository that is not evaluated (`installation_rejected`, `repository_disabled`, ...), except that a retry that finds the
 *   repository switched off sends the `finalise-check` job of the pull request first (E14-S04); ends `skipped:` when GitHub no
 *   longer shows the repository, the pull request, or serves the installation; ends `unchanged` for the idempotent case;
 *   ends `superseded` when the head moved or the pull request closed while it ran; ends `evaluated` otherwise.
 * - Throws what GitHub, the database, the listing (`CommitListingMismatchError`) or the reporter throws: the job fails and the
 *   queue retries it. A rate limit (`GitHubRateLimitedError`) is deliberately not caught.
 */
export async function evaluatePr(ports: EvaluatePrPorts, job: Job, context: EvaluatePrContext): Promise<JobOutcome> {
  try {
    return await run(ports, job, context);
  } catch (error) {
    if (isInstallationUnavailable(error)) {
      return skipped(context.logger, 'installation_unavailable');
    }
    throw error;
  }
}
