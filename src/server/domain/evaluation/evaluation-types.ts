// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import type { ActorFix, CoveredActor } from './coverage-types.ts';
import type { Advisory, FailureCode, FixCode, ListingState, Outcome, Policy } from './types.ts';
import type { AssessedFinding, UnlinkedFix } from './unlinked.ts';

// E08-S08: what the composition of the engine rules hands to the evaluation job (E07-S04), the reporter (E09) and the
// stored-details writer (`toStoredDetails`). It is plain readonly data, fully ordered, so the same facts give the same
// value.

/** Tell the contributor to split a pull request that has more commits than the engine evaluates. */
export interface SplitPullRequestFix {
  readonly code: Extract<FixCode, 'split_pull_request'>;
}

/** Every fix a result can ask for: one per uncovered actor, one per unlinked identity or commit, one for a huge pull request. */
export type EvaluationFix = ActorFix | UnlinkedFix | SplitPullRequestFix;

/**
 * The verdict on one pull request. `outcome` is `success` exactly when `failureCodes` is empty, and both outcomes carry
 * the actors with their covering basis, the findings, the advisories and the fixes, so a passing result still records why
 * it passed. `failureCodes` is sorted and unique, `actors` by numeric id, `findings` by SHA then role, `fixes` by code then
 * id or SHA. `findings` keep the display-only `raw` identity for the renderer (E09); `toStoredDetails` leaves it out.
 */
export interface Evaluation {
  readonly outcome: Outcome;
  readonly failureCodes: readonly FailureCode[];
  /** The CLA that was enforced, or `null` when the repository has no active one. */
  readonly policy: Policy | null;
  readonly listing: ListingState;
  /** Distinct commits that were evaluated, merge commits included; 0 when the listing is `exceeded`. */
  readonly commitCount: number;
  readonly mergeCommitsSkipped: number;
  readonly actors: readonly CoveredActor[];
  readonly findings: readonly AssessedFinding[];
  readonly advisories: readonly Advisory[];
  readonly fixes: readonly EvaluationFix[];
}
