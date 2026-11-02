// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import { parseGithubId } from '../../../shared/github-id.ts';
import { installationEligibility } from '../../domain/eligibility.ts';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import type { Tenant } from '../evaluate-pr/evaluation-facts.ts';
import { findInstallationByGithubId } from '../installation-queries.ts';
import type { JobOutcome } from '../job-registry.ts';
import { GitHubForbiddenError, GitHubNotFoundError, GitHubRateLimitedError } from '../ports/github-errors.ts';
import { isInstallationUnavailable } from '../ports/installation-unavailable.ts';
import { listEnabledRepositories } from '../repository-queries.ts';
import { refreshRepositorySnapshot } from '../repository-refresh.ts';
import type { SweepContext, SweepPorts } from './sweep-ports.ts';
import { sweepRepository } from './sweep-repository.ts';
import { addSettled, emptyTotals, type Settled } from './sweep-totals.ts';

// The `sweep-installation` job (E07-S08): the pull requests of one installation that missed a delivery are found and sent to be
// evaluated. The job is for one installation only, so a rate limit or a failure of one installation never stops another.

type Job = EnvelopeOf<'sweep-installation'>;

const skipped = (logger: Logger, reason: string): JobOutcome => {
  logger.info({ reason }, 'sweep_installation.skipped');
  return { outcome: `skipped:${reason}` };
};

/**
 * What stops the whole job and not one repository: the job is being shut down, GitHub's limit for the installation is spent
 * (the next repository would meet it too), or the installation is no longer served.
 */
const stopsTheJob = (error: unknown, signal: AbortSignal): boolean =>
  signal.aborted || error instanceof GitHubRateLimitedError || isInstallationUnavailable(error);

/**
 * A repository the sweep failed on. One GitHub does not show to the installation (404) or refuses (403) is read again through the
 * snapshot refresh (E05-S09), which marks it removed or renames it; any other failure is logged, and the next sweep tries again.
 * @throws what {@link stopsTheJob} says.
 */
async function recover(ports: SweepPorts, context: SweepContext, tenant: Tenant, error: unknown): Promise<Settled> {
  const githubRepoId = parseGithubId(tenant.repository.github_repo_id);
  let failure = error;
  if (error instanceof GitHubNotFoundError || error instanceof GitHubForbiddenError) {
    try {
      const refreshed = await refreshRepositorySnapshot(
        ports,
        parseGithubId(tenant.installation.github_installation_id),
        githubRepoId,
      );
      context.logger.info({ githubRepoId, status: refreshed.status }, 'sweep.repository_unreachable');
      return { kind: 'unreachable' };
    } catch (refreshError) {
      if (stopsTheJob(refreshError, context.signal)) {
        throw refreshError;
      }
      failure = refreshError;
    }
  }
  context.logger.warn({ err: failure, githubRepoId }, 'sweep.repository_failed');
  return { kind: 'failed' };
}

async function sweepOne(ports: SweepPorts, context: SweepContext, tenant: Tenant): Promise<Settled> {
  try {
    return { kind: 'swept', sweep: await sweepRepository(ports, context, tenant) };
  } catch (error) {
    if (stopsTheJob(error, context.signal)) {
      throw error;
    }
    return await recover(ports, context, tenant, error);
  }
}

async function run(ports: SweepPorts, job: Job, context: SweepContext): Promise<JobOutcome> {
  const installation = await findInstallationByGithubId(ports.db, job.githubInstallationId);
  if (installation === null) {
    return skipped(context.logger, 'installation_not_found');
  }
  const served = installationEligibility({
    admissionStatus: installation.admission_status,
    deletedAt: installation.deleted_at,
    suspendedAt: installation.suspended_at,
  });
  if (!served.eligible) {
    return skipped(context.logger, served.reason);
  }
  const totals = emptyTotals();
  for (const repository of await listEnabledRepositories(ports.db, installation.id)) {
    addSettled(totals, await sweepOne(ports, context, { installation, repository }));
  }
  context.logger.info(totals, 'sweep_installation.swept');
  return { outcome: totals.failed === 0 ? 'swept' : 'partial' };
}

/**
 * Sweeps the repositories of one installation (see {@link sweepRepository}), one after the other.
 * - Ends `skipped:<reason>` with no GitHub call for an installation that is not stored and for one the instance does not
 *   serve (rejected, deleted, suspended); ends `skipped:installation_unavailable` when GitHub or the gate stops serving it
 *   while the job runs.
 * - Ends `swept` when every enabled repository was swept, also one GitHub no longer shows (it is marked removed), and
 *   `partial` when a repository failed for another reason: it is logged (`sweep.repository_failed`) and the repositories
 *   after it are swept all the same.
 * - Throws a rate limit (the installation's budget is spent, so the queue retries the job later) and whatever aborts the job
 *   (a shutdown): the job fails and the queue retries it.
 */
export async function sweepInstallation(ports: SweepPorts, job: Job, context: SweepContext): Promise<JobOutcome> {
  try {
    return await run(ports, job, context);
  } catch (error) {
    if (isInstallationUnavailable(error)) {
      return skipped(context.logger, 'installation_unavailable');
    }
    throw error;
  }
}
