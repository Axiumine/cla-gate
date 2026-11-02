// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ListingPlan } from './listing-plan.ts';
import type { RepoWalkResult } from './repo-walk.ts';
import type { ListingState } from './types.ts';

// E08-S07: how the outcome of the listing becomes the `listing` field of the engine input (E08-S01). A mapping like
// this belongs here and not in the I/O loop of E07-S04, so the loop holds no decision.

/**
 * The `listing` state that a plan or a walk result stands for, or `null` when it does not settle it. A refused plan and
 * an exceeded walk are `exceeded`: the engine fails the pull request with the fix `split_pull_request` (E08-S08), and
 * a limit always fails closed. A walk that found its merge base is `complete`; the caller still checks the count with
 * `verifyListing`. A plan that has yet to fetch anything, a walk that needs another page and an inconsistent one give
 * `null`, so none of them can be mistaken for a whole list.
 */
export function listingStateOf(result: ListingPlan | RepoWalkResult): ListingState | null {
  if ('strategy' in result) {
    return result.strategy === 'refuse' ? 'exceeded' : null;
  }
  if (result.status === 'complete') {
    return 'complete';
  }
  return result.status === 'exceeded' ? 'exceeded' : null;
}
