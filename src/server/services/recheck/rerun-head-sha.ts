// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import { loadTenant, resolveRepository } from '../evaluate-pr/evaluation-tenant.ts';
import type { JobOutcome } from '../job-registry.ts';
import { isInstallationUnavailable } from '../ports/installation-unavailable.ts';
import { enqueueReruns, MAX_RERUN_PULL_REQUESTS, rerunOf } from './recheck-enqueue.ts';
import type { RecheckContext, RecheckPorts } from './recheck-ports.ts';

// The `evaluate-head-sha` job (E07-S07): somebody pressed Re-run on a Check Run or a check suite. The event names a head SHA
// and no pull request (a pull request from a fork is not in the event), so the job asks GitHub which open pull requests have
// that commit as their head and sends one evaluation for each.

type Job = EnvelopeOf<'evaluate-head-sha'>;

const skipped = (logger: Logger, reason: string): JobOutcome => {
  logger.info({ reason }, 'rerun.skipped');
  return { outcome: `skipped:${reason}` };
};

async function run(ports: RecheckPorts, job: Job, context: RecheckContext): Promise<JobOutcome> {
  const { logger, enqueuer } = context;
  const tenant = await loadTenant(ports.db, job);
  if (typeof tenant === 'string') {
    return skipped(logger, tenant);
  }
  const resolved = await resolveRepository(ports, job, tenant);
  if (resolved === null) {
    return skipped(logger, 'repository_gone');
  }
  const listed = await ports.github.listPullRequestsForCommit(job.githubInstallationId, resolved.fullName, job.headSha);
  const open = listed.filter((pull) => pull.state === 'open' && pull.headSha === job.headSha);
  if (open.length === 0) {
    return skipped(logger, 'no_pull_request');
  }
  const reruns = open
    .slice(0, MAX_RERUN_PULL_REQUESTS)
    .map(({ number }) => rerunOf(job, number, 'check_rerequested', `evaluate-head-sha:${context.jobId}:${number}`));
  return { outcome: await enqueueReruns(ports, enqueuer, logger, reruns) };
}

/**
 * Asks for a new evaluation of every open pull request whose head is `headSha`.
 * - Ends `skipped:<reason>` with no GitHub call for a repository that is not the installation's and for an installation or
 *   repository that is not evaluated; with `repository_gone` when GitHub no longer shows the repository, and with
 *   `installation_unavailable` when it no longer serves the installation.
 * - Ends `skipped:no_pull_request` when GitHub knows no open pull request with that head (a closed one, one whose head
 *   moved on, or a commit that is in none).
 * - Otherwise sends an `evaluate-pr` job with the trigger `check_rerequested` for each of the first 20, under the same limit as
 *   the `/recheck` command (one a minute per pull request): `enqueued`, or `rate_limited` when every send was dropped.
 * - Throws what GitHub, the queue or the database throws: the job fails and the queue retries it.
 */
export async function rerunHeadSha(ports: RecheckPorts, job: Job, context: RecheckContext): Promise<JobOutcome> {
  try {
    return await run(ports, job, context);
  } catch (error) {
    if (isInstallationUnavailable(error)) {
      return skipped(context.logger, 'installation_unavailable');
    }
    throw error;
  }
}
