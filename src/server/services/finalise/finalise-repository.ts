// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import type { RepositoryScope } from '../close-pr/close-rows.ts';
import type { EvaluatePrPorts } from '../evaluate-pr/evaluate-pr-ports.ts';
import { loadSwitchedOffTenant } from '../evaluate-pr/evaluation-tenant.ts';
import type { JobOutcome } from '../job-registry.ts';
import type { JobEnqueuer } from '../ports/jobs.ts';
import { enqueueFinaliseCheck } from '../repository-job-enqueue.ts';
import { FINALISE_BATCH, unfinishedPullRequests } from './finalise-rows.ts';

// The `finalise-repository` job (E14-S04): enforcement was turned off for a repository, and the pull requests whose check is still
// pending or red must not stay that way. The job names the repository by numeric ids and is told nothing else; it reads the
// stored rows only, makes no call to GitHub and writes no Check Run: it sends one `finalise-check` job per pull request, and
// that job looks at the pull request.

type Job = EnvelopeOf<'finalise-repository'>;

/** What the job needs of the application: the database. */
export type FinaliseRepositoryPorts = Pick<EvaluatePrPorts, 'db'>;

/** What the job needs of its run beyond the envelope. */
export interface FinaliseRepositoryContext {
  /** A logger that already carries the job id, type and numeric ids. */
  readonly logger: Logger;
  /** Where the `finalise-check` jobs are sent, on the connection of a transaction the job opens. */
  readonly enqueuer: JobEnqueuer;
  /** The id of the running job, which names the sends of one run so that a retry does not send twice. */
  readonly jobId: string;
}

/** Sends a `finalise-check` job for each of `prNumbers`, in one transaction, under keys that name the run. */
async function sendBatch(
  ports: FinaliseRepositoryPorts,
  context: FinaliseRepositoryContext,
  job: Job,
  prNumbers: readonly number[],
): Promise<void> {
  const { githubInstallationId, githubRepoId } = job;
  await ports.db.transaction().execute(async (tx) => {
    for (const prNumber of prNumbers) {
      await enqueueFinaliseCheck(tx, context.enqueuer, {
        githubInstallationId,
        githubRepoId,
        prNumber,
        idempotencyKey: `finalise-check:${context.jobId}:${String(githubRepoId)}:${String(prNumber)}`,
      });
    }
  });
}

/** Walks the pull requests of the repository 50 at a time and sends a job for each; the number of them. */
async function walk(
  ports: FinaliseRepositoryPorts,
  context: FinaliseRepositoryContext,
  job: Job,
  scope: RepositoryScope,
): Promise<number> {
  let sent = 0;
  let page = await unfinishedPullRequests(ports.db, scope, { after: 0, limit: FINALISE_BATCH });
  while (page.length > 0) {
    await sendBatch(ports, context, job, page);
    sent += page.length;
    page = await unfinishedPullRequests(ports.db, scope, { after: Math.max(...page), limit: FINALISE_BATCH });
  }
  return sent;
}

/**
 * Sends a `finalise-check` job for each pull request of the repository whose latest evaluation is `in_progress` or `failure`,
 * in batches of 50 pull requests, each batch in one transaction. A pull request whose latest evaluation is `success` is not
 * touched.
 * - Ends `skipped:<reason>` for a repository that is not the installation's (the ids of the payload are keys, and the repository
 *   is looked up under the installation), for an installation that is rejected, deleted or suspended, for a removed repository
 *   and for one whose enforcement is on again (`repository_enabled`: its own sweep evaluates the pull requests).
 * - Ends `queued` otherwise, also for a repository with nothing to finalise.
 * - Throws what the database or the queue throws: the job fails and the queue retries it, and the keys of its sends make the
 *   retry send nothing twice.
 */
export async function finaliseRepository(
  ports: FinaliseRepositoryPorts,
  job: Job,
  context: FinaliseRepositoryContext,
): Promise<JobOutcome> {
  const tenant = await loadSwitchedOffTenant(ports.db, job);
  if (typeof tenant === 'string') {
    context.logger.info({ reason: tenant }, 'finalise_repository.skipped');
    return { outcome: `skipped:${tenant}` };
  }
  const scope = { installationId: tenant.installation.id, repositoryId: tenant.repository.id };
  const pullRequests = await walk(ports, context, job, scope);
  context.logger.info({ pullRequests }, 'finalise_repository.queued');
  return { outcome: 'queued' };
}
