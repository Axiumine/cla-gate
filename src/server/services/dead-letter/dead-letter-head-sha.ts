// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import { evaluationsAtHead } from '../evaluate-pr/evaluation-rows.ts';
import { loadTenant, resolveRepository } from '../evaluate-pr/evaluation-tenant.ts';
import type { JobHandler, JobOutcome } from '../job-registry.ts';
import { fail, skipped, unlessUnavailable } from './dead-letter-failure.ts';
import type { FailurePorts, FailurePortsFor } from './dead-letter-ports.ts';

// The dead-letter handler of `evaluate-head-sha` (E07-S05): the re-run of a Check Run whose evaluation died.

async function failHeadSha(
  ports: FailurePorts,
  job: EnvelopeOf<'evaluate-head-sha'>,
  logger: Logger,
): Promise<JobOutcome> {
  const tenant = await loadTenant(ports.db, job);
  if (typeof tenant === 'string') {
    return skipped(logger, tenant);
  }
  const { installation, repository } = tenant;
  const stored = await evaluationsAtHead(
    ports.db,
    { installationId: installation.id, repositoryId: repository.id },
    job.headSha,
  );
  if (stored.length === 0) {
    return skipped(logger, 'no_evaluation');
  }
  const resolved = await resolveRepository(ports, job, tenant);
  if (resolved === null) {
    return skipped(logger, 'repository_gone');
  }
  for (const { prNumber } of stored) {
    await fail(ports, job, {
      resolved,
      prNumber,
      headSha: job.headSha,
      trigger: 'check_rerequested',
      finalVerdict: 'replace',
    });
  }
  return { outcome: 'reported' };
}

/**
 * `evaluate-head-sha`: the job carries its head SHA, so the pull requests are the evaluations stored at it (a re-run of a
 * Check Run needs one to exist). GitHub is asked for the repository only, to name it as it is now.
 */
export function deadEvaluateHeadSha(portsFor: FailurePortsFor): JobHandler<'evaluate-head-sha'> {
  return (job, { signal, logger }) => unlessUnavailable(logger, () => failHeadSha(portsFor(signal), job, logger));
}
