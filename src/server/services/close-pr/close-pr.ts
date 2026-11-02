// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import { loadTenant, resolveRepository } from '../evaluate-pr/evaluation-tenant.ts';
import type { JobOutcome } from '../job-registry.ts';
import { isInstallationUnavailable } from '../ports/installation-unavailable.ts';
import type { PendingJobs } from '../ports/jobs.ts';
import type { ClosePrPorts } from './close-pr-ports.ts';
import { prunePullRequest } from './prune.ts';

// The `close-pr` job (E07-S06): a pull request was closed, merged or not, and the work that waits for it is dropped. The job
// names the pull request by numeric ids and is told nothing else: the state of the pull request is read from GitHub now,
// because a close followed at once by a reopen is two jobs, and the close must not cancel the evaluation the reopen started.

type Job = EnvelopeOf<'close-pr'>;

/** What the job needs of its run beyond the envelope. */
export interface ClosePrContext {
  /** A logger that already carries the job id, type and numeric ids. */
  readonly logger: Logger;
  /** The queue the job runs on. */
  readonly pending: PendingJobs;
}

const skipped = (logger: Logger, reason: string): JobOutcome => {
  logger.info({ reason }, 'close_pr.skipped');
  return { outcome: `skipped:${reason}` };
};

async function run(ports: ClosePrPorts, job: Job, context: ClosePrContext): Promise<JobOutcome> {
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
  if (pr?.state === 'open') {
    return skipped(logger, 'pull_request_open');
  }
  const pruned = await prunePullRequest(ports, context.pending, {
    githubInstallationId: job.githubInstallationId,
    githubRepoId: job.githubRepoId,
    prNumber: job.prNumber,
    resolved,
    currentHeadSha: pr?.headSha,
  });
  logger.info(pruned, 'close_pr.pruned');
  return { outcome: 'closed' };
}

/**
 * Clears the work of a closed pull request (see {@link prunePullRequest}).
 * - Ends `skipped:<reason>` with no GitHub call for a repository that is not the installation's and for an installation or
 *   repository that is not evaluated; ends `skipped:repository_gone` when GitHub no longer shows the repository, and
 *   `skipped:installation_unavailable` when it no longer serves the installation; ends `skipped:pull_request_open` when
 *   the pull request was reopened before the job ran, because the evaluation the reopen started is not to be cancelled.
 * - Ends `closed` otherwise, also for a pull request GitHub no longer shows and for one that has no rows.
 * - Throws what GitHub, the queue, the database or the reporter throws: the job fails and the queue retries it.
 */
export async function closePr(ports: ClosePrPorts, job: Job, context: ClosePrContext): Promise<JobOutcome> {
  try {
    return await run(ports, job, context);
  } catch (error) {
    if (isInstallationUnavailable(error)) {
      return skipped(context.logger, 'installation_unavailable');
    }
    throw error;
  }
}
