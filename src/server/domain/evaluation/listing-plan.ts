// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FailureCode } from './types.ts';

// E08-S07: the paging rules for the commits of a pull request, as pure functions. GitHub's "list commits of a pull
// request" endpoint stops at 250 commits, so a larger pull request is read from the repository's own commit list (a
// graph walk, repo-walk.ts) up to a hard ceiling, and refused above it. The I/O loop of E07-S04 fetches pages and asks
// these functions what to do next, so it holds no decision of its own. Every limit fails closed: the engine never
// evaluates a partial list as if it were the whole pull request.

/** Both GitHub endpoints are read 100 commits to a page. */
export const COMMITS_PER_PAGE = 100;

/** The most commits GitHub's pull request commits endpoint returns; a pull request above this is read as a repo walk. */
export const MAX_PULL_COMMITS = 250;

/** The most commits the engine evaluates; a pull request above this fails with `commit_limit_exceeded`. */
export const MAX_EVALUATED_COMMITS = 2000;

/** The most pages of the repository commit list a repo walk may fetch before it gives up (25 pages of 100). */
export const MAX_WALK_PAGES = 25;

/** The failure code of a pull request that is too large to evaluate (E08-S08 turns it into a failure). */
export const COMMIT_LIMIT_CODE = 'commit_limit_exceeded' satisfies FailureCode;

/** How to list the commits of a pull request. `pages` is the number of pages of 100 to fetch, 0 for an empty pull request. */
export type ListingPlan =
  | { readonly strategy: 'pull_commits'; readonly pages: number }
  | { readonly strategy: 'repo_walk' }
  | { readonly strategy: 'refuse'; readonly code: typeof COMMIT_LIMIT_CODE };

/**
 * Chooses how to list a pull request that GitHub says has `prCommitCount` commits: its own endpoint up to 250 (the
 * number of pages is `ceil(n / 100)`), a repo walk from 251 to 2,000, and a refusal above that. A count that is not a
 * non-negative whole number cannot be trusted, so it is refused too, never planned.
 */
export function planCommitListing(prCommitCount: number): ListingPlan {
  if (!Number.isSafeInteger(prCommitCount) || prCommitCount < 0 || prCommitCount > MAX_EVALUATED_COMMITS) {
    return { strategy: 'refuse', code: COMMIT_LIMIT_CODE };
  }
  if (prCommitCount > MAX_PULL_COMMITS) {
    return { strategy: 'repo_walk' };
  }
  return { strategy: 'pull_commits', pages: Math.ceil(prCommitCount / COMMITS_PER_PAGE) };
}

/**
 * Checks a finished listing against the count GitHub reported for the pull request. A different count or a SHA listed
 * twice means a push landed while the pages were read (a page shifted), so the job fetches again once (E07-S04). SHAs
 * are compared in lower case.
 */
export function verifyListing(prCommitCount: number, receivedShas: readonly string[]): 'ok' | 'mismatch' {
  const distinct = new Set(receivedShas.map((sha) => sha.toLowerCase()));
  return receivedShas.length === prCommitCount && distinct.size === receivedShas.length ? 'ok' : 'mismatch';
}
