// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import { loadTenant, resolveRepository } from '../evaluate-pr/evaluation-tenant.ts';
import type { JobHandler, JobOutcome } from '../job-registry.ts';
import { failGroupEvaluation } from '../merge-group/merge-group-failure.ts';
import { skipped, unlessUnavailable } from './dead-letter-failure.ts';
import type { FailurePorts, FailurePortsFor } from './dead-letter-ports.ts';

// The dead-letter handler of `evaluate-merge-group` (E22-S01): a group whose evaluation was tried six times and never completed
// must not leave a merge queue waiting for a Check Run that never comes. If the installation and the repository are still
// evaluated and GitHub did not take the group down, its row is set to `failure` and the Check Run on its head SHA ends `failure`
// with the hint to remove the pull request from the queue and add it again (`/recheck` cannot be typed on a group).

async function failGroup(
  ports: FailurePorts,
  job: EnvelopeOf<'evaluate-merge-group'>,
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
  const { installation, repository } = tenant;
  const row = await failGroupEvaluation(
    ports.db,
    { installationId: installation.id, repositoryId: repository.id, headSha: job.headSha },
    job.baseSha,
  );
  if (row === null) {
    return skipped(logger, 'merge_group_destroyed');
  }
  await ports.reporter.mergeGroup(
    {
      githubInstallationId: job.githubInstallationId,
      githubRepoId: job.githubRepoId,
      fullName: resolved.fullName,
      headSha: job.headSha,
    },
    { state: 'errored' },
  );
  return { outcome: 'reported' };
}

/** `evaluate-merge-group`: the Check Run goes on the head SHA the job carries, never on one GitHub is asked for. */
export function deadEvaluateMergeGroup(portsFor: FailurePortsFor): JobHandler<'evaluate-merge-group'> {
  return (job, { signal, logger }) => unlessUnavailable(logger, () => failGroup(portsFor(signal), job, logger));
}
