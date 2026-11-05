// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import {
  detailsOfFailure,
  detailsOfMembers,
  type MemberResult,
  type MergeGroupDetails,
  resultOfMembers,
} from '../../domain/merge-group.ts';
import type { MergeGroupResult } from '../../domain/reporting/check-view.ts';
import { collectCommits, type ListingScope } from '../evaluate-pr/commit-listing.ts';
import type { EvaluatePrPorts } from '../evaluate-pr/evaluate-pr-ports.ts';
import { readEvaluationInput, type Tenant } from '../evaluate-pr/evaluation-facts.ts';
import { loadTenant, resolveRepository } from '../evaluate-pr/evaluation-tenant.ts';
import type { JobOutcome } from '../job-registry.ts';
import { mapConcurrently } from '../map-concurrently.ts';
import { isInstallationUnavailable } from '../ports/installation-unavailable.ts';
import { discoverMembers } from './member-discovery.ts';
import { finishGroupEvaluation, startGroupEvaluation } from './merge-group-rows.ts';

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

/** The most pull requests of one group that are read and evaluated at once. */
const MEMBER_CONCURRENCY = 5;

/**
 * A pull request of the group changed while its commits were being read (a push, a close): its commits cannot be settled now. The
 * job fails and the queue retries it; a push that took the pull request out of the queue has destroyed the group by then, and the
 * retry ends without a write.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode); the job lets it fail the run.
 */
export class MergeGroupMemberMovedError extends Error {
  override readonly name = 'MergeGroupMemberMovedError';

  constructor() {
    super('A pull request of the merge group changed while its commits were read');
  }
}

/** What the evaluation of a group came to: the details the row keeps and the result the Check Run shows. */
interface Verdict {
  readonly details: MergeGroupDetails;
  readonly result: MergeGroupResult;
}

/** A group whose pull requests could not be determined, or one of which is not an open pull request any more: a failure that names none. */
const UNDETERMINED: Verdict = {
  details: detailsOfFailure('pull_requests_not_determined'),
  result: { state: 'undetermined' },
};

const skipped = (logger: Logger, reason: string): JobOutcome => {
  logger.info({ reason }, 'evaluate_merge_group.skipped');
  return { outcome: `skipped:${reason}` };
};

/** What the evaluation of one pull request of the group needs besides the ports. */
interface MemberScope extends ListingScope {
  readonly tenant: Tenant;
}

/**
 * The engine's verdict on pull request `number` as it is now: its opener and its commits are read, the policy, the allowlist and the
 * signatures after them, as `evaluate-pr` reads them. `null` when it is not an open pull request any more.
 * @throws MergeGroupMemberMovedError when the pull request moved while its commits were read, and what GitHub and the database throw.
 */
async function evaluateMember(
  ports: EvaluatePrPorts,
  scope: MemberScope,
  number: number,
): Promise<MemberResult | null> {
  const { github, githubInstallationId, fullName, tenant } = scope;
  const pr = await github.getPullRequest(githubInstallationId, fullName, number);
  if (pr?.state !== 'open') {
    return null;
  }
  const collected = await collectCommits(scope, pr);
  if (collected.kind === 'superseded') {
    throw new MergeGroupMemberMovedError();
  }
  const evaluation = ports.evaluate(
    await readEvaluationInput(ports, { githubInstallationId, tenant, pr, listed: collected }),
  );
  return { prNumber: number, outcome: evaluation.outcome, failureCodes: evaluation.failureCodes };
}

/** Steps 4 and 5: the pull requests of the group and the verdict of the engine on each. */
async function judge(ports: EvaluatePrPorts, job: Job, scope: MemberScope): Promise<Verdict> {
  const discovered = await discoverMembers(scope, {
    baseSha: job.baseSha,
    headSha: job.headSha,
    tipPrNumber: job.tipPrNumber,
  });
  if (discovered.kind === 'undetermined') {
    return UNDETERMINED;
  }
  const evaluated = await mapConcurrently(discovered.numbers, MEMBER_CONCURRENCY, (number) =>
    evaluateMember(ports, scope, number),
  );
  const members = evaluated.filter((member): member is MemberResult => member !== null);
  return members.length < evaluated.length
    ? UNDETERMINED
    : { details: detailsOfMembers(members), result: resultOfMembers(members) };
}

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
 * - Throws what GitHub, the database or the reporter throws, and {@link MergeGroupMemberMovedError}: the job fails and the queue
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
