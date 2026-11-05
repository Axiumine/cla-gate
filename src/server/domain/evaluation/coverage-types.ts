// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ExtractedActor } from './actor-types.ts';
import type { CoveringBasis, EvaluationInput, FailureCode, FixCode, Outcome } from './types.ts';

// E08-S04: what signature and allowlist coverage hands to the composition (E08-S08); E21-S05 adds the corporate approval.

/** The facts coverage reads. Commits, overrides and listing state are deliberately not among them. */
export type CoverageFacts = Pick<
  EvaluationInput,
  'policy' | 'signatures' | 'allowlist' | 'orgMembers' | 'corporateCovered' | 'corporateOutdated'
>;

/** The fixes an uncovered actor gets. The ones about commits and listing belong to later stories (E08-S05, E08-S08). */
export type ActorFixCode = Extract<FixCode, 'sign_cla' | 'allowlist_bot' | 'allowlist_account'>;

/** What to do about one uncovered actor. It names the account by numeric id only, never by login, name or email. */
export interface ActorFix {
  readonly code: ActorFixCode;
  readonly githubId: number;
}

/**
 * An actor with the answer to "is it covered, and why". `covered` is true exactly when `basis` is not `null`.
 * `corporateOutdated` is present, and `true`, only for an uncovered person who holds an approval in force under an
 * agreement of an earlier major (E21-S05): the report tells the contributors to ask the CLA manager to sign the current
 * version. It is for the renderer and is never stored.
 */
export interface CoveredActor extends ExtractedActor {
  readonly covered: boolean;
  readonly basis: CoveringBasis | null;
  readonly corporateOutdated?: true;
}

/**
 * The verdict of the coverage rules alone. `failureCodes` is sorted and unique, `fixes` is sorted by code then id, and
 * `actors` keeps the order it was given. `outcome` is derived from `failureCodes`; the composition recomputes it once
 * the listing and the unlinked identities have added their own codes.
 */
export interface CoverageResult {
  readonly outcome: Outcome;
  readonly failureCodes: readonly FailureCode[];
  readonly actors: readonly CoveredActor[];
  readonly fixes: readonly ActorFix[];
}
