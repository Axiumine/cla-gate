// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { collectRepoWalk } from './repo-walk.ts';
import { driveWalk, line, paged, sha, walkCommit } from './test-support.ts';

// E08-S07: the limits of the repo walk. More than 2,000 commits, or a 25th page that does not settle it, fails closed.

const chain = (count: number) => line(2, count + 1);
const ask = (count: number, pagesFetched: number, exhausted: boolean) =>
  collectRepoWalk({ headSha: sha(count + 1), mergeBaseSha: sha(1), commits: chain(count), pagesFetched, exhausted });

test.each([
  [1999, 'complete'],
  [2000, 'complete'],
  [2001, 'exceeded'],
  [2002, 'exceeded'],
  [5000, 'exceeded'],
])('a walk over %i commits is %s', (count, status) => {
  expect(ask(count, 21, false).status).toBe(status);
});

test('2,000 commits list all 2,000', () => {
  const result = ask(2000, 20, true);
  expect(result.status === 'complete' && result.shas).toHaveLength(2000);
});

test.each([
  ['the repository has more pages', false],
  ['the repository is exhausted', true],
])(
  'more than 2,000 commits are exceeded, not inconsistent, when %s and the oldest parent is missing',
  (_name, exhausted) => {
    const commits = line(10, 2011);
    const result = collectRepoWalk({ headSha: sha(2011), mergeBaseSha: sha(1), commits, pagesFetched: 20, exhausted });
    expect(result).toEqual({ status: 'exceeded' });
  },
);

test('more than 2,000 commits are exceeded before the walk has reached the merge base', () => {
  const result = collectRepoWalk({
    headSha: sha(2500),
    mergeBaseSha: sha(1),
    commits: line(400, 2500),
    pagesFetched: 6,
    exhausted: false,
  });
  expect(result).toEqual({ status: 'exceeded' });
});

test('2,001 commits spread over a merge are counted once each, not once per path', () => {
  const left = line(10, 1010);
  const right = line(2000, 2999).map((commit, index) => (index === 0 ? walkCommit(2000, 1) : commit));
  const merge = walkCommit(5000, 1010, 2999);
  const result = collectRepoWalk({
    headSha: sha(5000),
    mergeBaseSha: sha(1),
    commits: [...left, ...right, merge],
    pagesFetched: 21,
    exhausted: false,
  });
  expect(result).toEqual({ status: 'exceeded' });
});

test.each([
  [0, 'need_next_page'],
  [1, 'need_next_page'],
  [24, 'need_next_page'],
  [25, 'exceeded'],
  [26, 'exceeded'],
  [Number.MAX_SAFE_INTEGER, 'exceeded'],
])('a walk stuck after %i pages is %s', (pagesFetched, status) => {
  const result = collectRepoWalk({
    headSha: sha(9),
    mergeBaseSha: sha(1),
    commits: [walkCommit(9, 8)],
    pagesFetched,
    exhausted: false,
  });
  expect(result.status).toBe(status);
});

test.each([
  ['not a number', Number.NaN],
  ['a fraction', 3.5],
  ['infinite', Number.POSITIVE_INFINITY],
])('a page counter that is %s counts as spent, so a bad counter ends the loop', (_name, pagesFetched) => {
  const result = collectRepoWalk({
    headSha: sha(9),
    mergeBaseSha: sha(1),
    commits: [],
    pagesFetched,
    exhausted: false,
  });
  expect(result).toEqual({ status: 'exceeded' });
});

test('a walk that is stuck on the 25th page is inconsistent, not exceeded, when that was the last page', () => {
  const result = collectRepoWalk({
    headSha: sha(9),
    mergeBaseSha: sha(1),
    commits: [walkCommit(9, 8)],
    pagesFetched: 25,
    exhausted: true,
  });
  expect(result).toEqual({ status: 'inconsistent' });
});

test.each([24, 25, 26, 30])('a walk that settles is complete after %i pages, however many it took', (pagesFetched) => {
  const result = collectRepoWalk({
    headSha: sha(3),
    mergeBaseSha: sha(1),
    commits: line(2, 3),
    pagesFetched,
    exhausted: false,
  });
  expect(result).toEqual({ status: 'complete', shas: [sha(2), sha(3)] });
});

// Commit dates are not topological: `baseCount` commits of the base branch dated newer than the pull request come first
// in the listing (newest first, 100 to a page). The merge base is the tip of that branch, commit `baseCount + 1`.
function skewedListing(baseCount: number, prCommits: number) {
  const base = line(2, baseCount + 1).toReversed();
  const pullRequest = line(baseCount + 2, baseCount + 1 + prCommits).toReversed();
  return driveWalk(paged([...base, ...pullRequest]), sha(baseCount + 1 + prCommits), sha(baseCount + 1));
}

test('a pull request listed on page 25 is complete with 25 pages fetched', () => {
  const { result, pagesFetched } = skewedListing(2400, 100);
  expect(pagesFetched).toBe(25);
  expect(result.status === 'complete' && result.shas).toHaveLength(100);
});

test.each([
  ['commits that run past page 25', 2400, 150],
  ['a head on page 26', 2500, 3],
])('a pull request with %s fails closed as exceeded', (_name, baseCount, prCommits) => {
  const { result, pagesFetched } = skewedListing(baseCount, prCommits);
  expect(pagesFetched).toBe(25);
  expect(result).toEqual({ status: 'exceeded' });
});
