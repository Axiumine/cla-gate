// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { extractActors } from './actors.ts';
import { addCoAuthors } from './co-authors.ts';
import { assessCoverage } from './coverage.ts';
import type { Evaluation, EvaluationFix } from './evaluation-types.ts';
import { compareEvaluationFixes } from './fixes.ts';
import { assessListing } from './listing-check.ts';
import { outcomeOf, sortedUniqueCodes } from './outcome.ts';
import type { CommitFacts, EvaluationInput, FailureCode } from './types.ts';
import { assessUnlinked } from './unlinked.ts';

// E08-S08: the composition. Every rule of E08-S02 to E08-S07 is a pure function of plain facts; this module runs them in
// one fixed order and aggregates what they say. Nothing here reads a clock, a random number, the environment or any
// text, so the same facts always give the same, fully ordered value.

/** The commits the rules may read. A partial list is never evaluated as if it were the whole pull request (E08-S07). */
function readableCommits(input: EvaluationInput): readonly CommitFacts[] {
  return input.listing === 'complete' ? input.commits : [];
}

function distinctCommitCount(commits: readonly CommitFacts[]): number {
  return new Set(commits.map((commit) => commit.sha.toLowerCase())).size;
}

/**
 * Decides whether a pull request is covered by the repository's CLA, in this order: the policy check, the listing check,
 * actor extraction, the co-authors of the trailers, the unlinked findings, classification, the allowlist and signature
 * coverage, and the aggregation. The outcome is `success` exactly when `failureCodes` is empty.
 *
 * Without an active CLA (`policy === null`) the one failure code is `no_active_cla`: signing, linking, overriding and
 * splitting are all moot until a CLA exists, and the next evaluation reports them. The actors are still listed, all
 * uncovered. With a listing that is `exceeded` the commits that were handed over are not read at all, because which of
 * them arrived depends on where the listing stopped; the pull request fails with `commit_limit_exceeded`, and the opener
 * is still assessed, since the opener is covered or the outcome is a failure whatever the commits say. The function does
 * not throw on a well-typed input, an empty one included.
 */
export function evaluatePullRequest(input: EvaluationInput): Evaluation {
  const hasActiveCla = input.policy !== null;
  const listing = assessListing(input.listing);
  const commits = readableCommits(input);
  const extraction = addCoAuthors(extractActors({ ...input, commits }), commits);
  const unlinked = assessUnlinked(extraction.unlinked, input.overrides);
  const coverage = assessCoverage(input, extraction.actors);
  const failureCodes: FailureCode[] = hasActiveCla
    ? sortedUniqueCodes([...coverage.failureCodes, ...listing.failureCodes, ...unlinked.failureCodes])
    : [...coverage.failureCodes];
  const fixes: EvaluationFix[] = hasActiveCla
    ? [...coverage.fixes, ...listing.fixes, ...unlinked.fixes].sort(compareEvaluationFixes)
    : [];
  return {
    outcome: outcomeOf(failureCodes),
    failureCodes,
    policy: input.policy,
    listing: input.listing,
    commitCount: distinctCommitCount(commits),
    mergeCommitsSkipped: extraction.mergeCommitsSkipped,
    actors: coverage.actors,
    findings: unlinked.findings,
    advisories: extraction.advisories,
    fixes,
  };
}
