// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import { failEvaluation } from '../evaluate-pr/evaluation-rows.ts';
import type { Resolved } from '../evaluate-pr/evaluation-tenant.ts';
import type { JobOutcome } from '../job-registry.ts';
import { isInstallationUnavailable } from '../ports/installation-unavailable.ts';
import type { FailurePorts } from './dead-letter-ports.ts';

// What the dead-letter handlers of the evaluation jobs have in common (E07-S05): the report of one
// failed pull request (its row becomes `failure`, its Check Run ends `failure`), and the end of a job that has nothing to
// report. The handler reads and writes only what the job's installation owns, and it never marks a delivery processed: the
// retries failed, so GitHub's redelivery must requeue it.

/** The job ends without a report, and says why. */
export function skipped(logger: Logger, reason: string): JobOutcome {
  logger.info({ reason }, 'dead_letter.skipped');
  return { outcome: `skipped:${reason}` };
}

/** One pull request whose Check Run is to end `failure`: where it is and the head SHA GitHub shows. */
export interface Failed {
  readonly resolved: Resolved;
  readonly prNumber: number;
  readonly headSha: string;
  readonly trigger: EnvelopeOf<'evaluate-pr'>['trigger'];
}

/** Sets the row of the head SHA to `failure` and completes its Check Run. Both are idempotent: the handler may run again. */
export async function fail(ports: FailurePorts, job: EnvelopeOf<'evaluate-pr' | 'evaluate-head-sha'>, failed: Failed) {
  const { installation, repository } = failed.resolved.tenant;
  const evaluationId = await failEvaluation(ports.db, {
    installationId: installation.id,
    repositoryId: repository.id,
    prNumber: failed.prNumber,
    headSha: failed.headSha,
  });
  await ports.reporter.failed(
    {
      githubInstallationId: job.githubInstallationId,
      githubRepoId: job.githubRepoId,
      fullName: failed.resolved.fullName,
      prNumber: failed.prNumber,
      headSha: failed.headSha,
      trigger: failed.trigger,
      evaluationId,
    },
    'evaluation_failed',
  );
}

/** Runs `report`, and ends the job as skipped when GitHub says the installation is no longer served. */
export async function unlessUnavailable(logger: Logger, report: () => Promise<JobOutcome>): Promise<JobOutcome> {
  try {
    return await report();
  } catch (error) {
    if (isInstallationUnavailable(error)) {
      return skipped(logger, 'installation_unavailable');
    }
    throw error;
  }
}
