// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import { loadTenant, resolveRepository } from '../evaluate-pr/evaluation-tenant.ts';
import type { JobHandler, JobOutcome } from '../job-registry.ts';
import { fail, skipped, unlessUnavailable } from './dead-letter-failure.ts';
import type { FailurePorts, FailurePortsFor } from './dead-letter-ports.ts';

// The dead-letter handler of `evaluate-pr` (E07-S05): a pull request whose evaluation was tried six times and never
// completed must not keep a Check Run `in_progress`. If the installation and the repository are still evaluated, the head
// SHA is read from GitHub now, its row is set to `failure` with a code that names nobody, and the reporter completes the
// Check Run as `failure` with the hint to comment `/recheck`.

async function failPullRequest(
  ports: FailurePorts,
  job: EnvelopeOf<'evaluate-pr'>,
  logger: Logger,
): Promise<JobOutcome> {
  const tenant = await loadTenant(ports.db, job);
  if (typeof tenant === 'string') {
    return skipped(logger, tenant);
  }
  const resolved = await resolveRepository(ports, job, tenant);
  if (resolved === null) {
    return skipped(logger, 'repository_gone');
  }
  const pr = await ports.github.getPullRequest(job.githubInstallationId, resolved.fullName, job.prNumber);
  if (pr === null) {
    return skipped(logger, 'pull_request_not_found');
  }
  if (pr.state !== 'open') {
    return skipped(logger, 'pull_request_closed');
  }
  const reported = await fail(ports, job, {
    resolved,
    prNumber: job.prNumber,
    headSha: pr.headSha,
    trigger: job.trigger,
    finalVerdict: 'keep',
  });
  return reported ? { outcome: 'reported' } : skipped(logger, 'evaluation_final');
}

/** `evaluate-pr`: the head SHA is the one GitHub shows for the pull request now, which is the one the Check Run belongs to. */
export function deadEvaluatePr(portsFor: FailurePortsFor): JobHandler<'evaluate-pr'> {
  return (job, { signal, logger }) => unlessUnavailable(logger, () => failPullRequest(portsFor(signal), job, logger));
}
