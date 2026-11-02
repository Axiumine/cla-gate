// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { planCommitListing } from './listing-plan.ts';
import { listingStateOf } from './listing-state.ts';
import { collectRepoWalk } from './repo-walk.ts';
import { line, sha, walkCommit } from './test-support.ts';

// E08-S07: the refuse and exceeded results map to listing 'exceeded'; nothing that is not settled can be 'complete'.

test.each([
  ['a refused plan (2,001 commits)', planCommitListing(2001), 'exceeded'],
  ['a plan for the pull request endpoint', planCommitListing(250), null],
  ['a plan for a repo walk', planCommitListing(251), null],
  ['an empty pull request plan', planCommitListing(0), null],
  ['a walk that found its merge base', { status: 'complete', shas: [sha(2)] }, 'complete'],
  ['a walk that needs the next page', { status: 'need_next_page' }, null],
  ['an exceeded walk', { status: 'exceeded' }, 'exceeded'],
  ['an inconsistent walk', { status: 'inconsistent' }, null],
] as const)('listingStateOf: %s settles to %s', (_name, result, expected) => {
  expect(listingStateOf(result)).toBe(expected);
});

test.each([
  ['more than 2,000 commits', 2001, 'exceeded'],
  ['exactly 2,000 commits', 2000, 'complete'],
])('listingStateOf: a real walk over %s settles to %s', (_name, count, expected) => {
  const result = collectRepoWalk({
    headSha: sha(count + 1),
    mergeBaseSha: sha(1),
    commits: line(2, count + 1),
    pagesFetched: 21,
    exhausted: false,
  });
  expect(listingStateOf(result)).toBe(expected);
});

test('a walk over a head that has not been fetched yet is not a list', () => {
  const result = collectRepoWalk({
    headSha: sha(5),
    mergeBaseSha: sha(1),
    commits: [walkCommit(3, 2)],
    pagesFetched: 1,
    exhausted: false,
  });
  expect(result).toEqual({ status: 'need_next_page' });
  expect(listingStateOf(result)).toBeNull();
});
