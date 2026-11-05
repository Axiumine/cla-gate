// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import type { EvaluatePrPorts } from '../evaluate-pr/evaluate-pr-ports.ts';
import { loadTenant, resolveRepository } from '../evaluate-pr/evaluation-tenant.ts';
import type { JobOutcome } from '../job-registry.ts';
import { isInstallationUnavailable } from '../ports/installation-unavailable.ts';
import { judge } from './judge-merge-group.ts';
import { finishGroupEvaluation, startGroupEvaluation } from './merge-group-progress.ts';

// The `evaluate-merge-group` job (E22-S01): the evaluation of one merge queue group, reported on the head SHA of the group, which
// is what GitHub waits for before it merges. The job names the group by numeric ids and two SHAs and is told nothing else;
// everything it decides on is read now, in a fixed order:
//
//   1. the stored tenant, 2. the repository (its name may have changed), 3. the row of the group, put in progress (a group that was
//   taken down ends the job here), 4. the pull requests of the group, 5. each pull request, its commits and the facts of the
//   engine, 6. the verdict, stored on the row unless the group was taken down meanwhile, 7. the report.
//
// Fail closed: every doubt is a failure, never a pass. A group with no pull request that can be determined, with more than 25, or
// with one that is gone, ends in a failure with the fixed sentence of the story. A pull request that GitHub cannot be asked about
// (an outage, a rate limit) makes the job throw, so the queue retries it, and nothing is stored or written until every pull request
// has a verdict. A group is `success` only when every pull request of it passes the engine.

type Job = EnvelopeOf<'evaluate-merge-group'>;

/** What the job needs of its run beyond the envelope. */
export interface MergeGroupContext {
  /** A logger that already carries the job id, type and numeric ids. */
  readonly logger: Logger;
}

const skipped = (logger: Logger, reason: string): JobOutcome => {
  logger.info({ reason }, 'evaluate_merge_group.skipped');
  return { outcome: `skipped:${reason}` };
};

async function run(ports: EvaluatePrPorts, job: Job, { logger }: MergeGroupContext): Promise<JobOutcome> {
  const tenant = await loadTenant(ports.db, job);
  if (typeof tenant === 'string') {
    return skipped(logger, tenant);
  }
  const resolved = await resolveRepository(ports, job, tenant);
  if (resolved === null) {
    return skipped(logger, 'repository_gone');
  }
  const { installation, repository } = tenant;
  const row = await startGroupEvaluation(
    ports.db,
    { installationId: installation.id, repositoryId: repository.id, headSha: job.headSha },
    job.baseSha,
  );
  if (row === null) {
    return skipped(logger, 'merge_group_destroyed');
  }
  const { fullName } = resolved;
  const scope = { github: ports.github, githubInstallationId: job.githubInstallationId, fullName, tenant };
  const verdict = await judge(ports, job, scope);
  // The last look at the group before anything is written: a group that was taken down while it was evaluated gets no report.
  if (!(await finishGroupEvaluation(ports.db, installation.id, row.id, verdict.details))) {
    return skipped(logger, 'merge_group_destroyed');
  }
  const reported = await ports.reporter.mergeGroup(
    { githubInstallationId: job.githubInstallationId, githubRepoId: job.githubRepoId, fullName, headSha: job.headSha },
    verdict.result,
  );
  if (reported.status === 'skipped') {
    return skipped(logger, reported.reason);
  }
  logger.info({ result: verdict.details.outcome }, 'evaluate_merge_group.evaluated');
  return { outcome: 'evaluated' };
}

/**
 * Evaluates the group of a merge queue: the protocol above, with the facts of now. The Check Run is written on `job.headSha`
 * whatever head SHAs the pull requests of the group have.
 * - Ends `skipped:<reason>` with no GitHub call for a repository that is not the installation's or not evaluated, and when GitHub no
 *   longer shows the repository or serves the installation; ends `skipped:merge_group_destroyed` when the group was taken down, before
 *   or while it was evaluated; ends `evaluated` otherwise, with the Check Run written.
 * - Throws what GitHub, the database or the reporter throws, and `MergeGroupMemberMovedError` (judge-merge-group.ts): the job fails and the queue
 *   retries it. A rate limit (`GitHubRateLimitedError`) is deliberately not caught.
 */
export async function evaluateMergeGroup(
  ports: EvaluatePrPorts,
  job: Job,
  context: MergeGroupContext,
): Promise<JobOutcome> {
  try {
    return await run(ports, job, context);
  } catch (error) {
    if (isInstallationUnavailable(error)) {
      return skipped(context.logger, 'installation_unavailable');
    }
    throw error;
  }
}
