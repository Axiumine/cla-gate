// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import {
  detailsOfFailure,
  detailsOfMembers,
  type MemberResult,
  type MergeGroupDetails,
  resultOfMembers,
} from '../../domain/merge-group.ts';
import type { MergeGroupResult } from '../../domain/reporting/check-view.ts';
import type { ListingScope } from '../evaluate-pr/commit-history.ts';
import { collectCommits } from '../evaluate-pr/commit-listing.ts';
import type { EvaluatePrPorts } from '../evaluate-pr/evaluate-pr-ports.ts';
import { readEvaluationInput, type Tenant } from '../evaluate-pr/evaluation-facts.ts';
import { mapConcurrently } from '../map-concurrently.ts';
import { discoverMembers } from './member-discovery.ts';

// The judgement of a merge group (E22-S01), apart from the protocol of the job (evaluate-merge-group.ts) to keep each file small:
// steps 4 and 5 of that protocol, the pull requests of the group and the engine's verdict on each, read as they are now.

type Job = EnvelopeOf<'evaluate-merge-group'>;

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
export interface Verdict {
  readonly details: MergeGroupDetails;
  readonly result: MergeGroupResult;
}

/** A group whose pull requests could not be determined, or one of which is not an open pull request any more: a failure that names none. */
const UNDETERMINED: Verdict = {
  details: detailsOfFailure('pull_requests_not_determined'),
  result: { state: 'undetermined' },
};

/** What the evaluation of one pull request of the group needs besides the ports. */
export interface MemberScope extends ListingScope {
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
export async function judge(ports: EvaluatePrPorts, job: Job, scope: MemberScope): Promise<Verdict> {
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
