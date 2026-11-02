// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import { loadTenant, resolveRepository } from '../evaluate-pr/evaluation-tenant.ts';
import type { JobOutcome } from '../job-registry.ts';
import { isInstallationUnavailable } from '../ports/installation-unavailable.ts';
import { listOpenPulls } from './open-pulls.ts';
import { enqueueEvaluations, POLICY_CHANGE_REQUEST } from './sweep-enqueue.ts';
import type { PolicySweepPorts, SweepContext } from './sweep-ports.ts';

// The `sweep-repository` job (E07-S09): the policy of a repository changed (a CLA version, the CLA of the repository, the
// allowlist, a signature, an override, enforcement turned on), and the open pull requests may have another result now. The job
// lists them and sends an evaluation for each; the evaluation reads the policy when it runs, so one run covers every change that
// came before it. The job never writes a Check Run or a comment: `evaluate-pr` does, with its own head SHA discipline.

type Job = EnvelopeOf<'sweep-repository'>;

/** What the job needs of its run beyond the envelope. */
export type PolicySweepContext = Pick<SweepContext, 'logger' | 'enqueuer' | 'jobId'>;

const skipped = (context: PolicySweepContext, reason: string): JobOutcome => {
  context.logger.info({ reason }, 'sweep_repository.skipped');
  return { outcome: `skipped:${reason}` };
};

async function run(ports: PolicySweepPorts, job: Job, context: PolicySweepContext): Promise<JobOutcome> {
  const tenant = await loadTenant(ports.db, job);
  if (typeof tenant === 'string') {
    return skipped(context, tenant);
  }
  const resolved = await resolveRepository(ports, job, tenant);
  if (resolved === null) {
    return skipped(context, 'repository_gone');
  }
  const listing = await listOpenPulls(ports.github, job.githubInstallationId, resolved.fullName);
  const sent = await enqueueEvaluations(
    ports,
    context,
    {
      githubInstallationId: job.githubInstallationId,
      githubRepoId: job.githubRepoId,
      prNumbers: listing.pulls.map(({ number }) => number),
    },
    POLICY_CHANGE_REQUEST,
  );
  context.logger.info(
    { ...sent, listed: listing.pulls.length, truncated: listing.truncated },
    'sweep_repository.swept',
  );
  return { outcome: 'swept' };
}

/**
 * Evaluates the open pull requests of a repository again because its policy changed: at most ten pages of 100, and one
 * `evaluate-pr` job with the trigger `policy_change` for each, under a dedupe window of a minute per pull request.
 * - Ends `skipped:<reason>` with no GitHub call for a repository that is not the installation's (the ids of the payload are
 *   keys, and the repository is looked up under the installation) and for one that is not evaluated: a rejected, deleted or
 *   suspended installation, a removed or a disabled repository. Ends `skipped:repository_gone` when GitHub no longer shows the
 *   repository, and `skipped:installation_unavailable` when it no longer serves the installation.
 * - Ends `swept` otherwise, also for a repository with no open pull request. A pull request beyond the first 1,000 is
 *   left to its next event (`truncated` in the log line).
 * - Throws what GitHub, the queue or the database throws, a rate limit among them: the job fails and the queue retries it.
 */
export async function sweepPolicyChange(
  ports: PolicySweepPorts,
  job: Job,
  context: PolicySweepContext,
): Promise<JobOutcome> {
  try {
    return await run(ports, job, context);
  } catch (error) {
    if (isInstallationUnavailable(error)) {
      return skipped(context, 'installation_unavailable');
    }
    throw error;
  }
}
