// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { collectRepoWalk } from './repo-walk.ts';
import { driveWalk, line, paged, sha, shuffled, walkCommit } from './test-support.ts';

// E08-S07: the graph walk from the head to the merge base. Commit n has the SHA `sha(n)`; `line(a, b)` chains them.

const walk = (headSha: string, mergeBaseSha: string, commits: ReturnType<typeof line>) =>
  collectRepoWalk({ headSha, mergeBaseSha, commits, pagesFetched: 1, exhausted: false });

test('a head equal to the merge base is complete with no commits, even before anything is fetched', () => {
  expect(
    collectRepoWalk({ headSha: sha(7), mergeBaseSha: sha(7), commits: [], pagesFetched: 0, exhausted: false }),
  ).toEqual({
    status: 'complete',
    shas: [],
  });
});

test('a head equal to the merge base in a different case is still complete with no commits', () => {
  const result = walk(sha(255).toUpperCase(), sha(255), [walkCommit(9, 8)]);
  expect(result).toEqual({ status: 'complete', shas: [] });
});

test('a one-commit pull request lists that commit and never needs the merge base itself', () => {
  expect(walk(sha(2), sha(1), [walkCommit(2, 1)])).toEqual({ status: 'complete', shas: [sha(2)] });
});

test('the merge base is excluded even when it was fetched, and so is everything behind it', () => {
  const result = walk(sha(4), sha(2), [...line(1, 4)]);
  expect(result).toEqual({ status: 'complete', shas: [sha(3), sha(4)] });
});

test('commits that are fetched but not reachable from the head are left out', () => {
  const result = walk(sha(3), sha(1), [...line(2, 3), walkCommit(50, 49), walkCommit(51, 50)]);
  expect(result).toEqual({ status: 'complete', shas: [sha(2), sha(3)] });
});

test('the SHAs are returned sorted, whatever order the commits and parents come in', () => {
  const result = walk(sha(0xa), sha(1), [walkCommit(0xa, 9), walkCommit(9, 0xf), walkCommit(0xf, 2), walkCommit(2, 1)]);
  expect(result).toEqual({ status: 'complete', shas: [sha(2), sha(9), sha(0xa), sha(0xf)] });
});

// The SHAs have letters in them (0xa1 is `...00a1`), so the upper-case form really is another string.
const A1 = sha(0xa1);
const A2 = sha(0xa2);
const A3 = sha(0xa3);
const A4 = sha(0xa4);
const chainA = [walkCommit(0xa4, 0xa3), walkCommit(0xa3, 0xa2), walkCommit(0xa2, 0xa1)];
const upperCommit = (commit: ReturnType<typeof walkCommit>) => ({
  sha: commit.sha.toUpperCase(),
  parents: commit.parents.map((parent) => parent.toUpperCase()),
});

test.each([
  ['the head', A4.toUpperCase(), A1, chainA],
  ['the commits and their parents', A4, A1, chainA.map(upperCommit)],
  [
    'the parents only',
    A4,
    A1,
    chainA.map((commit) => ({ ...commit, parents: commit.parents.map((p) => p.toUpperCase()) })),
  ],
  ['the commits only', A4, A1, chainA.map((commit) => ({ ...commit, sha: commit.sha.toUpperCase() }))],
  ['the merge base', A4, A1.toUpperCase(), chainA],
])('SHAs in upper case are compared in lower case: %s', (_name, head, mergeBase, commits) => {
  expect(walk(head, mergeBase, commits)).toEqual({ status: 'complete', shas: [A2, A3, A4] });
});

test('a linear history of 300 commits is read from three pages and lists all 300', () => {
  const history = [...line(1, 350)];
  const pages = paged(history.toReversed());
  const { result, pagesFetched } = driveWalk(pages, sha(350), sha(50));
  expect(pagesFetched).toBe(3);
  expect(result.status).toBe('complete');
  expect(result.status === 'complete' && result.shas).toEqual(line(51, 350).map((commit) => commit.sha));
});

test.each([
  ['10 commits (merge base on page 1)', 10, 1],
  ['100 commits (the page is full)', 100, 1],
  ['101 commits', 101, 2],
  ['500 commits (the merge base would open page 6, and is never needed)', 500, 5],
  ['501 commits (the oldest one is on page 6)', 501, 6],
  ['550 commits (merge base on page 6)', 550, 6],
])('a history of %s needs the right number of pages', (_name, count, pages) => {
  const history = [...line(1, 40 + count)];
  const { result, pagesFetched } = driveWalk(paged(history.toReversed()), sha(40 + count), sha(40));
  expect(pagesFetched).toBe(pages);
  expect(result.status === 'complete' && result.shas).toHaveLength(count);
});

test('a head that is on page 1 but whose parents are not asks for the next page, never completes early', () => {
  const pages = paged(line(1, 250).toReversed());
  const first = collectRepoWalk({
    headSha: sha(250),
    mergeBaseSha: sha(10),
    commits: pages[0] ?? [],
    pagesFetched: 1,
    exhausted: false,
  });
  expect(first).toEqual({ status: 'need_next_page' });
});

test('a merge base listed on page 1 does not end the walk when a commit of the pull request is dated later', () => {
  const pages = [
    [walkCommit(1), walkCommit(4, 3)],
    [walkCommit(3, 2), walkCommit(2, 1)],
  ];
  const first = collectRepoWalk({
    headSha: sha(4),
    mergeBaseSha: sha(1),
    commits: pages[0] ?? [],
    pagesFetched: 1,
    exhausted: false,
  });
  expect(first).toEqual({ status: 'need_next_page' });
  expect(driveWalk(pages, sha(4), sha(1))).toEqual({
    result: { status: 'complete', shas: [sha(2), sha(3), sha(4)] },
    pagesFetched: 2,
  });
});

test.each([
  ['an ancestor on an earlier page than its descendant', [[3, 5], [1, 4], [2]], 2],
  ['an ancestor two pages after its descendant', [[3, 5], [2, 1], [4]], 3],
  ['every commit in its own page, newest last', [[3], [4], [5]], 3],
])('interleaved dates: %s', (_name, order, pagesNeeded) => {
  const parents = new Map([
    [5, 4],
    [4, 3],
    [3, 2],
  ]);
  const pages = order.map((page) => page.map((n) => walkCommit(n, parents.get(n) ?? n - 1)));
  const { result, pagesFetched } = driveWalk(pages, sha(5), sha(2));
  expect(pagesFetched).toBe(pagesNeeded);
  expect(result).toEqual({ status: 'complete', shas: [sha(3), sha(4), sha(5)] });
});

test('merges inside the pull request: a diamond lists both branches and the merge', () => {
  const commits = [walkCommit(2, 1), walkCommit(3, 1), walkCommit(4, 2, 3), walkCommit(5, 4)];
  expect(walk(sha(5), sha(1), commits)).toEqual({ status: 'complete', shas: [sha(2), sha(3), sha(4), sha(5)] });
});

test('merges inside the pull request: merging the base back in ends that path at the merge base', () => {
  const commits = [walkCommit(2, 1), walkCommit(3, 2, 1)];
  expect(walk(sha(3), sha(1), commits)).toEqual({ status: 'complete', shas: [sha(2), sha(3)] });
});

test('merges inside the pull request: one branch of a merge that is not fetched yet needs the next page', () => {
  const commits = [walkCommit(2, 1), walkCommit(4, 2, 3), walkCommit(5, 4)];
  expect(walk(sha(5), sha(1), commits)).toEqual({ status: 'need_next_page' });
});

test('a root commit reached before the merge base ends the walk as complete and is part of the list', () => {
  const commits = [walkCommit(10), walkCommit(11, 10), walkCommit(12, 11)];
  expect(walk(sha(12), sha(99), commits)).toEqual({ status: 'complete', shas: [sha(10), sha(11), sha(12)] });
});

test('a root commit on one branch of a merge and the merge base on the other is complete', () => {
  const commits = [walkCommit(2, 1), walkCommit(7), walkCommit(8, 2, 7)];
  expect(walk(sha(8), sha(1), commits)).toEqual({ status: 'complete', shas: [sha(2), sha(7), sha(8)] });
});

test.each([
  ['a parent', sha(5), [walkCommit(5, 4), walkCommit(3, 2)]],
  ['the head', sha(5), [walkCommit(4, 3), walkCommit(3, 2)]],
  ['the head, with nothing fetched', sha(5), []],
])('%s that is not fetched yet asks for the next page while the repository has more', (_name, head, commits) => {
  expect(collectRepoWalk({ headSha: head, mergeBaseSha: sha(1), commits, pagesFetched: 1, exhausted: false })).toEqual({
    status: 'need_next_page',
  });
});

test.each([
  ['a parent', [walkCommit(5, 4), walkCommit(3, 2)]],
  ['the head, which is on no page', [walkCommit(4, 3), walkCommit(3, 2)]],
  ['the head, with an empty repository', []],
])('%s that is missing once the repository is exhausted is inconsistent', (_name, commits) => {
  expect(collectRepoWalk({ headSha: sha(5), mergeBaseSha: sha(1), commits, pagesFetched: 3, exhausted: true })).toEqual(
    {
      status: 'inconsistent',
    },
  );
});

test('exhausted does not matter when nothing is missing', () => {
  const result = collectRepoWalk({
    headSha: sha(3),
    mergeBaseSha: sha(1),
    commits: line(2, 3),
    pagesFetched: 1,
    exhausted: true,
  });
  expect(result).toEqual({ status: 'complete', shas: [sha(2), sha(3)] });
});

test('a commit repeated across pages, even in a different case, counts once', () => {
  const commits = [
    walkCommit(0xa3, 0xa2),
    walkCommit(0xa2, 0xa1),
    walkCommit(0xa3, 0xa2),
    { sha: A2.toUpperCase(), parents: [A1.toUpperCase()] },
  ];
  expect(walk(A3, A1, commits)).toEqual({ status: 'complete', shas: [A2, A3] });
});

test('the same commit in two cases with two different parent lists is inconsistent', () => {
  const commits = [walkCommit(0xa3, 0xa2), { sha: A3.toUpperCase(), parents: [sha(0xa9)] }, walkCommit(0xa2, 0xa1)];
  expect(walk(A3, A1, commits)).toEqual({ status: 'inconsistent' });
});

test('the same commit with two different parent lists is inconsistent, whichever came first', () => {
  const a = walkCommit(3, 2);
  const b = walkCommit(3, 9);
  const rest = [walkCommit(2, 1), walkCommit(9, 1)];
  expect(walk(sha(3), sha(1), [a, ...rest, b])).toEqual({ status: 'inconsistent' });
  expect(walk(sha(3), sha(1), [b, ...rest, a])).toEqual({ status: 'inconsistent' });
});

test.each([
  ['a parent more', walkCommit(4, 2), walkCommit(4, 2, 3)],
  ['a parent fewer', walkCommit(4, 2, 3), walkCommit(4, 2)],
  ['a root commit that has a parent elsewhere', walkCommit(4), walkCommit(4, 2)],
])('the same commit listed with %s is inconsistent', (_name, first, second) => {
  const rest = [walkCommit(2, 1), walkCommit(3, 1)];
  expect(walk(sha(4), sha(1), [first, ...rest, second])).toEqual({ status: 'inconsistent' });
});

test('the same merge commit with its parents in a different order is inconsistent: the order is part of the hash', () => {
  expect(walk(sha(4), sha(1), [walkCommit(4, 2, 3), walkCommit(4, 3, 2), walkCommit(2, 1), walkCommit(3, 1)])).toEqual({
    status: 'inconsistent',
  });
});

test.each([1, 2, 3, 4, 5])('shuffling the commits (seed %i) gives the same answer', (seed) => {
  const commits = [...line(2, 60), walkCommit(80, 59, 60), walkCommit(81, 80), walkCommit(3, 2)];
  const expected = walk(sha(81), sha(1), commits);
  expect(expected.status).toBe('complete');
  expect(walk(sha(81), sha(1), shuffled(commits, seed))).toEqual(expected);
});

test('the walk changes neither its input nor the commits in it', () => {
  const commits = [walkCommit(3, 2), walkCommit(2, 1)];
  const input = { headSha: sha(3), mergeBaseSha: sha(1), commits, pagesFetched: 1, exhausted: false };
  const before = structuredClone(input);
  collectRepoWalk(input);
  expect(input).toEqual(before);
});
