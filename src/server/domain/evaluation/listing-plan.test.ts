// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  COMMIT_LIMIT_CODE,
  COMMITS_PER_PAGE,
  MAX_EVALUATED_COMMITS,
  MAX_PULL_COMMITS,
  MAX_WALK_PAGES,
  planCommitListing,
  verifyListing,
} from './listing-plan.ts';
import { FAILURE_CODES } from './types.ts';

// E08-S07: the plan for listing the commits of a pull request, and the check of a finished listing.

test('the limits are the ones GitHub and the story fix: 100 per page, 250, 2,000 and 25 pages', () => {
  expect([COMMITS_PER_PAGE, MAX_PULL_COMMITS, MAX_EVALUATED_COMMITS, MAX_WALK_PAGES]).toEqual([100, 250, 2000, 25]);
});

test('the refusal code is one of the failure codes of the vocabulary', () => {
  expect(FAILURE_CODES).toContain(COMMIT_LIMIT_CODE);
});

test.each([
  [0, 0],
  [1, 1],
  [99, 1],
  [100, 1],
  [101, 2],
  [200, 2],
  [201, 3],
  [250, 3],
])('%i commits are read from the pull request endpoint in %i pages', (count, pages) => {
  expect(planCommitListing(count)).toEqual({ strategy: 'pull_commits', pages });
});

test.each([251, 252, 1000, 1999, 2000])('%i commits are read as a repo walk', (count) => {
  expect(planCommitListing(count)).toEqual({ strategy: 'repo_walk' });
});

test.each([2001, 2002, 100_000, Number.MAX_SAFE_INTEGER, Number.POSITIVE_INFINITY])(
  '%i commits are refused with commit_limit_exceeded',
  (count) => {
    expect(planCommitListing(count)).toEqual({ strategy: 'refuse', code: 'commit_limit_exceeded' });
  },
);

test.each([
  ['negative', -1],
  ['a fraction', 1.5],
  ['not a number', Number.NaN],
  ['negative infinity', Number.NEGATIVE_INFINITY],
])('a count that is %s is refused, never planned', (_name, count) => {
  expect(planCommitListing(count)).toEqual({ strategy: 'refuse', code: 'commit_limit_exceeded' });
});

test('every count up to 250 needs exactly the pages that hold it', () => {
  for (let count = 1; count <= MAX_PULL_COMMITS; count += 1) {
    const plan = planCommitListing(count);
    expect(plan.strategy).toBe('pull_commits');
    const pages = plan.strategy === 'pull_commits' ? plan.pages : 0;
    expect(pages * COMMITS_PER_PAGE).toBeGreaterThanOrEqual(count);
    expect((pages - 1) * COMMITS_PER_PAGE).toBeLessThan(count);
  }
});

const shas = (count: number): string[] =>
  Array.from({ length: count }, (_unused, n) => n.toString(16).padStart(40, '0'));

test.each([
  ['an empty pull request', 0, 0],
  ['one commit', 1, 1],
  ['250 commits', 250, 250],
])('verifyListing: %s listed in full is ok', (_name, count, listed) => {
  expect(verifyListing(count, shas(listed))).toBe('ok');
});

test.each([
  ['one commit fewer than the count', 5, 4],
  ['one commit more than the count', 5, 6],
  ['nothing for a pull request with commits', 3, 0],
  ['a commit for an empty pull request', 0, 1],
])('verifyListing: %s is a mismatch', (_name, count, listed) => {
  expect(verifyListing(count, shas(listed))).toBe('mismatch');
});

test.each([
  ['the same SHA twice', ['a'.repeat(40), 'b'.repeat(40), 'a'.repeat(40)]],
  ['the same SHA twice, in different case', ['a'.repeat(40), 'b'.repeat(40), 'A'.repeat(40)]],
])('verifyListing: %s is a mismatch even when the count matches', (_name, received) => {
  expect(verifyListing(received.length, received)).toBe('mismatch');
});

test('verifyListing: a count that is not a number never matches', () => {
  expect(verifyListing(Number.NaN, [])).toBe('mismatch');
  expect(verifyListing(Number.NaN, shas(2))).toBe('mismatch');
});

test('verifyListing does not depend on the order of the SHAs', () => {
  expect(verifyListing(3, shas(3).toReversed())).toBe('ok');
});
