// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { verifyListing } from './listing-plan.ts';
import { collectRepoWalk, type WalkCommit } from './repo-walk.ts';
import { driveWalk, line, paged, sha, walkCommit } from './test-support.ts';

// E08-S07: the pull request is what the head reaches and the merge base does not (`git rev-list base..head`), so a path
// that goes round the merge base and into old base-branch history must not add commits to it. This is what a long-lived
// branch that merged its base back in looks like.

/** The base branch is R <- A <- B <- C; the feature branch left A (t1), merged B back in (M) and went on (t2). */
function mergedBackHistory(offset: number) {
  const commits = {
    r: walkCommit(offset),
    a: walkCommit(offset + 1, offset),
    b: walkCommit(offset + 2, offset + 1),
    c: walkCommit(offset + 3, offset + 2),
    t1: walkCommit(offset + 4, offset + 1),
    m: walkCommit(offset + 5, offset + 4, offset + 2),
    t2: walkCommit(offset + 6, offset + 5),
  };
  return { ...commits, all: Object.values(commits) };
}

const finished = (headSha: string, mergeBaseSha: string, commits: readonly WalkCommit[]) =>
  collectRepoWalk({ headSha, mergeBaseSha, commits, pagesFetched: 1, exhausted: true });

test('a branch that merged its base back in lists only its own commits, not the base history behind the merge base', () => {
  // base C, head t2: git says the merge base is B and the pull request is t1, M, t2.
  expect(finished(sha(6), sha(2), mergedBackHistory(0).all)).toEqual({
    status: 'complete',
    shas: [sha(4), sha(5), sha(6)],
  });
});

test('the same history is read the same way in upper case, with SHAs that have letters in them', () => {
  const upper = mergedBackHistory(0xab0).all.map((commit) => ({
    sha: commit.sha.toUpperCase(),
    parents: commit.parents.map((parent) => parent.toUpperCase()),
  }));
  expect(finished(sha(0xab6).toUpperCase(), sha(0xab2).toUpperCase(), upper)).toEqual({
    status: 'complete',
    shas: [sha(0xab4), sha(0xab5), sha(0xab6)],
  });
  expect(finished(sha(0xab6), sha(0xab2), upper)).toEqual({
    status: 'complete',
    shas: [sha(0xab4), sha(0xab5), sha(0xab6)],
  });
});

test('the side branch is read before the merge base: the walk waits for the merge base, then excludes what is behind it', () => {
  const { r, a, b, c, t1, m, t2 } = mergedBackHistory(0);
  const pages = [
    [t2, m, t1],
    [c, b],
    [a, r],
  ];
  // A is not needed: B names it as its parent, which is enough to know that it lies behind the merge base.
  expect(driveWalk(pages, sha(6), sha(2))).toEqual({
    result: { status: 'complete', shas: [sha(4), sha(5), sha(6)] },
    pagesFetched: 2,
  });
});

test('a walk is not complete while the merge base is not fetched and a side branch leads past it', () => {
  const { t1, m, t2 } = mergedBackHistory(0);
  const result = collectRepoWalk({
    headSha: sha(6),
    mergeBaseSha: sha(2),
    commits: [t2, m, t1],
    pagesFetched: 1,
    exhausted: false,
  });
  expect(result).toEqual({ status: 'need_next_page' });
});

test('3,000 commits of base history behind a merge of the base do not make a 4-commit pull request exceeded', () => {
  // main is 1 <- 2 <- ... <- 3000; the branch left main at 2700, merged main at 2800 (the merge base) and went on.
  const main = [walkCommit(1), ...line(2, 3000)];
  const feature = [
    walkCommit(4000, 2700),
    walkCommit(4001, 4000),
    walkCommit(4002, 4001, 2800),
    walkCommit(4003, 4002),
  ];
  const result = finished(sha(4003), sha(2800), [...main, ...feature]);
  expect(result).toEqual({ status: 'complete', shas: [sha(4000), sha(4001), sha(4002), sha(4003)] });
});

test('read from the newest page, that pull request settles as soon as the fork point is fetched', () => {
  const feature = [
    walkCommit(4003, 4002),
    walkCommit(4002, 4001, 2800),
    walkCommit(4001, 4000),
    walkCommit(4000, 2700),
  ];
  const main = [...line(2, 3000).toReversed(), walkCommit(1)];
  const { result, pagesFetched } = driveWalk(paged([...feature, ...main]), sha(4003), sha(2800));
  expect(result).toEqual({ status: 'complete', shas: [sha(4000), sha(4001), sha(4002), sha(4003)] });
  expect(pagesFetched).toBe(4);
});

test('a head that is the merge base or lies behind it is a pull request of no commits', () => {
  const commits = [...line(2, 9), walkCommit(1)];
  expect(finished(sha(9), sha(9), commits)).toEqual({ status: 'complete', shas: [] });
  expect(finished(sha(5), sha(9), commits)).toEqual({ status: 'complete', shas: [] });
});

test('a merge base that was not fetched excludes itself and nothing else', () => {
  expect(finished(sha(4), sha(1), line(2, 4))).toEqual({ status: 'complete', shas: [sha(2), sha(3), sha(4)] });
});

test('two merge bases (a criss-cross merge): one of them is excluded, and the count GitHub reports refuses the rest', () => {
  // a is the root; p1 and q1 branch off it and are merged into each other: base = P2, head = Q2 plus h.
  const [a, p1, q1, p2, q2, h] = [1, 2, 3, 4, 5, 6];
  const commits = [
    walkCommit(a),
    walkCommit(p1, a),
    walkCommit(q1, a),
    walkCommit(p2, p1, q1),
    walkCommit(q2, q1, p1),
    walkCommit(h, q2),
  ];
  const result = finished(sha(h), sha(p1), commits);
  // git lists q2 and h (2 commits); with only p1 known as a merge base the walk also reaches q1, so it lists 3.
  expect(result).toEqual({ status: 'complete', shas: [sha(q1), sha(q2), sha(h)] });
  expect(result.status === 'complete' && verifyListing(2, result.shas)).toBe('mismatch');
});

/** `count` diamonds in a row on top of commit 1: each has two sides off the one below and a merge of the two. */
function diamonds(count: number): WalkCommit[] {
  return Array.from({ length: count }, (_unused, step) => {
    const below = step === 0 ? 1 : 2 + 3 * (step - 1) + 2;
    const left = 2 + 3 * step;
    return [walkCommit(left, below), walkCommit(left + 1, below), walkCommit(left + 2, left, left + 1)];
  }).flat();
}

const DIAMONDS = 16;
const TOP = 2 + 3 * (DIAMONDS - 1) + 2;

const callCount = (spy: { readonly mock: { readonly calls: readonly unknown[] } }): number => spy.mock.calls.length;

/** How many map lookups a walk takes: with a visited check it grows with the commits, without it with the paths (2^16). */
function lookupsOf(run: () => unknown): number {
  // type-coverage:ignore-next-line -- `Map.prototype` is `Map<any, any>` in lib.d.ts; the spy only counts calls.
  const lookups = vi.spyOn(Map.prototype, 'get');
  try {
    run();
    return callCount(lookups);
  } finally {
    lookups.mockRestore();
  }
}

test('16 diamonds of merges in the pull request are walked once each, not once per path', () => {
  const commits = [walkCommit(1), ...diamonds(DIAMONDS)];
  let result: unknown;
  const lookups = lookupsOf(() => {
    result = finished(sha(TOP), sha(1), commits);
  });
  const everyCommit = Array.from({ length: TOP - 1 }, (_unused, index) => sha(index + 2));
  expect(result).toEqual({ status: 'complete', shas: everyCommit });
  expect(lookups).toBeLessThan(500);
});

test('16 diamonds behind the merge base are walked once each too', () => {
  const commits = [walkCommit(1), ...diamonds(DIAMONDS), walkCommit(TOP + 1, TOP), walkCommit(TOP + 2, TOP + 1)];
  let result: unknown;
  const lookups = lookupsOf(() => {
    result = finished(sha(TOP + 2), sha(TOP), commits);
  });
  expect(result).toEqual({ status: 'complete', shas: [sha(TOP + 1), sha(TOP + 2)] });
  expect(lookups).toBeLessThan(500);
});
