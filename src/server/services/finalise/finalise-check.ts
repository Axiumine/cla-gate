// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import type { ClosePrPorts } from '../close-pr/close-pr-ports.ts';
import type { Tenant } from '../evaluate-pr/evaluation-facts.ts';
import { findEvaluation } from '../evaluate-pr/evaluation-rows.ts';
import { loadSwitchedOffTenant, type Resolved, resolveRepository } from '../evaluate-pr/evaluation-tenant.ts';
import type { JobOutcome } from '../job-registry.ts';
import { isInstallationUnavailable } from '../ports/installation-unavailable.ts';
import type { JobEnqueuer } from '../ports/jobs.ts';
import type { ReportOutcome, RunTarget } from '../ports/reporter.ts';
import { isRepositoryEnabled } from '../repository-queries.ts';
import { type EvaluationRequest, enqueueEvaluations } from '../sweep/sweep-enqueue.ts';

// The `finalise-check` job (E14-S04): enforcement was turned off for a repository, and the `license/cla` check of one of its pull
// requests must not stay pending or red behind a rule nobody enforces any more. The job names the pull request by numeric ids and
// is told nothing else: the repository, the pull request and its head SHA are read now, because the head may have moved since the
// job was sent. A pull request that is open gets its Check Run completed `neutral` and its comment rewritten to the one-line notice
// by the reporter (E09-S06); `pr_evaluations.result` gets no new value, `neutral` exists on GitHub only.

type Job = EnvelopeOf<'finalise-check'>;

/** What the job needs of its run beyond the envelope. */
export interface FinaliseCheckContext {
  /** A logger that already carries the job id, type and numeric ids. */
  readonly logger: Logger;
  /** Where the evaluation of a pull request whose repository was turned on again is sent. */
  readonly enqueuer: JobEnqueuer;
  /** The id of the running job, which names the send so that a retry does not send twice. */
  readonly jobId: string;
}

/** The evaluation a pull request gets when the repository was turned on again while its check was being completed. */
const REEVALUATION: EvaluationRequest = {
  trigger: 'policy_change',
  idempotencyKey: (jobId, githubRepoId, prNumber) =>
    `finalise-check-reevaluation:${jobId}:${String(githubRepoId)}:${String(prNumber)}`,
};

/** What the report is about: the tenant, the repository as GitHub names it, the head SHA and the evaluation row of that head SHA. */
interface Located {
  readonly tenant: Tenant;
  readonly resolved: Resolved;
  readonly headSha: string;
  readonly evaluationId: number;
}

const skipped = (logger: Logger, reason: string): JobOutcome => {
  logger.info({ reason }, 'finalise_check.skipped');
  return { outcome: `skipped:${reason}` };
};

/**
 * Finds what the report is about, or the reason to skip the job: a repository that is not evaluated for a reason other than its
 * enforcement being off, one GitHub no longer shows, a pull request that is gone or closed, and a head SHA this platform never
 * evaluated, which has no check of ours to complete.
 */
async function locate(ports: ClosePrPorts, job: Job): Promise<Located | string> {
  const tenant = await loadSwitchedOffTenant(ports.db, job);
  if (typeof tenant === 'string') {
    return tenant;
  }
  const resolved = await resolveRepository(ports, job, tenant);
  if (resolved === null) {
    return 'repository_gone';
  }
  const pr = await ports.github.getPullRequest(job.githubInstallationId, resolved.fullName, job.prNumber);
  if (pr?.state !== 'open') {
    return pr === null ? 'pull_request_not_found' : 'pull_request_closed';
  }
  const evaluation = await findEvaluation(ports.db, {
    installationId: tenant.installation.id,
    repositoryId: tenant.repository.id,
    prNumber: job.prNumber,
    headSha: pr.headSha,
  });
  return evaluation === null ? 'no_evaluation' : { tenant, resolved, headSha: pr.headSha, evaluationId: evaluation.id };
}

/** The target of the report: the pull request at the head SHA that was located. */
function targetOf(job: Job, located: Located): RunTarget {
  return {
    githubInstallationId: job.githubInstallationId,
    githubRepoId: job.githubRepoId,
    fullName: located.resolved.fullName,
    prNumber: job.prNumber,
    headSha: located.headSha,
    evaluationId: located.evaluationId,
  };
}

/** How the report ended, as the job's outcome: a skip of the reporter is a skip of the job. */
function outcomeOf(logger: Logger, reported: ReportOutcome): JobOutcome {
  return reported.status === 'reported' ? { outcome: 'finalised' } : skipped(logger, reported.reason);
}

async function run(ports: ClosePrPorts, job: Job, context: FinaliseCheckContext): Promise<JobOutcome> {
  const located = await locate(ports, job);
  if (typeof located === 'string') {
    return skipped(context.logger, located);
  }
  const reported = await ports.reporter.enforcementDisabled(targetOf(job, located));
  // A person may have turned enforcement on again while the report was written: the sweep that follows an enable may have
  // evaluated the pull request before this neutral result landed, so the pull request is evaluated once more.
  if (await isRepositoryEnabled(ports.db, located.tenant.installation.id, located.tenant.repository.id)) {
    await enqueueEvaluations(
      ports,
      context,
      { githubInstallationId: job.githubInstallationId, githubRepoId: job.githubRepoId, prNumbers: [job.prNumber] },
      REEVALUATION,
    );
  }
  return outcomeOf(context.logger, reported);
}

/**
 * Completes the check of one pull request of a repository whose enforcement was turned off (see {@link run}).
 * - Ends `skipped:<reason>` with no GitHub call for a repository that is not the installation's, an installation that is not
 *   served, a removed repository and one whose enforcement is on again (`repository_enabled`: its sweep evaluates the pull
 *   request); ends `skipped:` when GitHub no longer shows the repository or the pull request, or no longer serves the
 *   installation, when the pull request is closed, and when its head SHA has no evaluation (`no_evaluation`).
 * - Ends `finalised` when the reporter completed the check `neutral`, and also when it found the repository enforcing again
 *   (the pull request is then sent to be evaluated).
 * - Throws what GitHub, the queue, the database or the reporter throws, a rate limit among them: the job fails and the queue
 *   retries it. The report is idempotent.
 */
export async function finaliseCheck(ports: ClosePrPorts, job: Job, context: FinaliseCheckContext): Promise<JobOutcome> {
  try {
    return await run(ports, job, context);
  } catch (error) {
    if (isInstallationUnavailable(error)) {
      return skipped(context.logger, 'installation_unavailable');
    }
    throw error;
  }
}
