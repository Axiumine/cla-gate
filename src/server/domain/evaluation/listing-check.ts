// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { EvaluationFix } from './evaluation-types.ts';
import { COMMIT_LIMIT_CODE } from './listing-plan.ts';
import type { FailureCode, ListingState } from './types.ts';

// E08-S08: what the state of the commit listing (E08-S07) means for the verdict.

export interface ListingAssessment {
  readonly failureCodes: readonly FailureCode[];
  readonly fixes: readonly EvaluationFix[];
}

/**
 * A complete listing adds nothing. An `exceeded` one fails the pull request with `commit_limit_exceeded` and the fix
 * `split_pull_request`: a limit always fails closed, so the engine never passes a pull request whose commits it did not
 * read in full. A switch, so a new listing state fails to compile until it is judged here.
 */
export function assessListing(listing: ListingState): ListingAssessment {
  switch (listing) {
    case 'complete':
      return { failureCodes: [], fixes: [] };
    case 'exceeded':
      return { failureCodes: [COMMIT_LIMIT_CODE], fixes: [{ code: 'split_pull_request' }] };
  }
}
