// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import type { JobOutcome } from '../job-registry.ts';
import {
  InstallationGoneError,
  InstallationNotAdmittedError,
  InstallationSuspendedError,
} from '../ports/github-errors.ts';
import { evaluateOpen, evaluationKey } from './evaluate-open.ts';
import type { EvaluatePrContext, EvaluatePrPorts } from './evaluate-pr-ports.ts';
import { type EvaluationKey, findEvaluation } from './evaluation-rows.ts';
import { loadTenant, resolveRepository } from './evaluation-tenant.ts';

// The `evaluate-pr` job (E07-S04): the protocol around the pure engine. The job names a pull request by numeric ids and is
// told nothing else; everything it decides on is read now, from GitHub and from the database, in a fixed order:
//
//   1. the repository (its name may have changed), 2. the pull request, 3. the evaluation row in progress and the report that
//   it began, 4. the commits, 5. the policy facts, 6. the signatures, last, 7. the engine, 8. the pull request again.
//
// Step 8 decides whether the verdict may be written: a push or a close during the run discards it, because the Check Run is
// per head SHA and the push that moved the head sent a delivery of its own.

type Job = EnvelopeOf<'evaluate-pr'>;

const skipped = (logger: Logger, reason: string): JobOutcome => {
  logger.info({ reason }, 'evaluate_pr.skipped');
  return { outcome: `skipped:${reason}` };
};

/** A final result: the verdict is written and the run is over. */
const isFinal = (result: 'in_progress' | 'success' | 'failure'): boolean =>
  result === 'success' || result === 'failure';

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
  const tenant = await loadTenant(ports.db, job);
  if (typeof tenant === 'string') {
    return skipped(logger, tenant);
  }
  const resolved = await resolveRepository(ports, job, tenant);
  if (resolved === null) {
    return skipped(logger, 'repository_gone');
  }
  const pr = await ports.github.getPullRequest(job.githubInstallationId, resolved.fullName, job.prNumber);
  if (pr?.state !== 'open') {
    return skipped(logger, pr === null ? 'pull_request_not_found' : 'pull_request_closed');
  }
  if (await alreadyEvaluated(ports, job, context, evaluationKey(tenant, job, pr))) {
    logger.info('evaluate_pr.unchanged');
    return { outcome: 'unchanged' };
  }
  return evaluateOpen({ ports, job, resolved, logger }, pr);
}

/**
 * Evaluates one pull request: the protocol above, with the facts of now.
 * - Ends `skipped:<reason>` with no GitHub call for a repository that is not the installation's, an installation or
 *   repository that is not evaluated (`installation_rejected`, `repository_disabled`, ...); ends `skipped:` when GitHub no
 *   longer shows the repository, the pull request, or serves the installation; ends `unchanged` for the idempotent case;
 *   ends `superseded` when the head moved or the pull request closed while it ran; ends `evaluated` otherwise.
 * - Throws what GitHub, the database, the listing (`CommitListingMismatchError`) or the reporter throws: the job fails and the
 *   queue retries it. A rate limit (`GitHubRateLimitedError`) is deliberately not caught.
 */
export async function evaluatePr(ports: EvaluatePrPorts, job: Job, context: EvaluatePrContext): Promise<JobOutcome> {
  try {
    return await run(ports, job, context);
  } catch (error) {
    if (
      error instanceof InstallationNotAdmittedError ||
      error instanceof InstallationGoneError ||
      error instanceof InstallationSuspendedError
    ) {
      return skipped(context.logger, 'installation_unavailable');
    }
    throw error;
  }
}
