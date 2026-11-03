// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { commit, commitSha, pullRequest } from '../github-pull-contract/test-support.ts';
import type { GitHubCommit, GitHubPullRequest } from '../ports/github.ts';
import { FakeGitHub } from '../test-support.ts';
import { type Collected, CommitListingMismatchError, collectCommits } from './commit-listing.ts';
import { FULL_NAME, INSTALLATION, ORG, REPOSITORY } from './test-support.ts';

// How the commits of a pull request are read (E07-S04): the pages, the repository walk, and the one second look a listing
// that does not add up gets.

function listingWorld() {
  const fake = new FakeGitHub();
  fake.addInstallation(
    {
      id: INSTALLATION,
      account: { id: ORG, login: 'org-1', type: 'Organization' },
      suspendedAt: null,
      permissions: {},
    },
    [{ id: REPOSITORY, fullName: FULL_NAME }],
  );
  const scope = { github: fake, githubInstallationId: INSTALLATION, fullName: FULL_NAME };
  const calls = () => fake.calls.map((call) => call.method);
  return { fake, scope, calls };
}

/** The commits `from` to `to`, each on the one before. */
const chain = (from: number, to: number): GitHubCommit[] =>
  Array.from({ length: to - from + 1 }, (_, index) => commit(from + index));

/** A pull request of `count` commits on top of commit `base`, as the pull request commits endpoint lists them. */
const stacked = (base: number, count: number): GitHubPullRequest =>
  pullRequest(7, { baseSha: commitSha(base), headSha: commitSha(base + count), commitCount: count });

/** The SHAs of a listing, which a test that asks for them expects to be one. */
function shasOf(collected: Collected): string[] {
  if (collected.kind !== 'listed') {
    throw new Error('the pull request was superseded: there is no listing');
  }
  return collected.commits.map((one) => one.sha);
}

test('a pull request of 250 commits is read from three pages of the pull request endpoint', async () => {
  const { fake, scope, calls } = listingWorld();
  fake.setPullRequestCommits(INSTALLATION, FULL_NAME, 7, chain(11, 260));
  const collected = await collectCommits(scope, stacked(10, 250));
  expect(collected).toMatchObject({ kind: 'listed', listing: 'complete' });
  expect(shasOf(collected)).toEqual(chain(11, 260).map((one) => one.sha));
  expect(calls()).toEqual(['listPullRequestCommits', 'listPullRequestCommits', 'listPullRequestCommits']);
});

test('a pull request with no commits is a complete listing that asks for nothing', async () => {
  const { scope, calls } = listingWorld();
  expect(await collectCommits(scope, stacked(10, 0))).toEqual({ kind: 'listed', listing: 'complete', commits: [] });
  expect(calls()).toEqual([]);
});

test('a pull request of 300 commits is walked through the repository history: the merge base, then pages until the walk is complete', async () => {
  const { fake, scope, calls } = listingWorld();
  const history = chain(1, 400).reverse();
  fake.setRepositoryCommits(INSTALLATION, FULL_NAME, history);
  fake.setMergeBase(INSTALLATION, FULL_NAME, { baseSha: commitSha(100), headSha: commitSha(400) }, commitSha(100));
  const collected = await collectCommits(scope, stacked(100, 300));
  expect(collected).toMatchObject({ kind: 'listed', listing: 'complete' });
  expect(new Set(shasOf(collected))).toEqual(new Set(chain(101, 400).map((one) => one.sha)));
  expect(calls()).toEqual([
    'compareCommits',
    'listRepositoryCommits',
    'listRepositoryCommits',
    'listRepositoryCommits',
  ]);
});

test('a commit that a shifted page lists twice is kept once', async () => {
  const { fake, scope } = listingWorld();
  const history = chain(1, 400).reverse();
  fake.setRepositoryCommits(INSTALLATION, FULL_NAME, [
    ...history.slice(0, 100),
    ...history.slice(99, 100),
    ...history.slice(100),
  ]);
  fake.setMergeBase(INSTALLATION, FULL_NAME, { baseSha: commitSha(100), headSha: commitSha(400) }, commitSha(100));
  const collected = await collectCommits(scope, stacked(100, 300));
  expect(collected).toMatchObject({ kind: 'listed', listing: 'complete' });
  expect(shasOf(collected)).toHaveLength(300);
});

test('a pull request of more than 2000 commits is exceeded, without a single listing call', async () => {
  const { scope, calls } = listingWorld();
  expect(await collectCommits(scope, stacked(10, 2001))).toEqual({ kind: 'listed', listing: 'exceeded', commits: [] });
  expect(calls()).toEqual([]);
});

test('a walk that is still lost after the 25th page is exceeded, and carries no commits', async () => {
  const { fake, scope, calls } = listingWorld();
  fake.setRepositoryCommits(INSTALLATION, FULL_NAME, [commit(400), ...chain(10_001, 12_999)]);
  fake.setMergeBase(INSTALLATION, FULL_NAME, { baseSha: commitSha(100), headSha: commitSha(400) }, commitSha(100));
  expect(await collectCommits(scope, stacked(100, 300))).toEqual({ kind: 'listed', listing: 'exceeded', commits: [] });
  expect(calls().filter((method) => method === 'listRepositoryCommits')).toHaveLength(25);
});

test('a walk that reaches the end of the history with a parent missing is a mismatch: the pull request is read again, and the second walk fails the job', async () => {
  const { fake, scope, calls } = listingWorld();
  fake.addPullRequest(INSTALLATION, FULL_NAME, stacked(100, 300));
  fake.setRepositoryCommits(INSTALLATION, FULL_NAME, [commit(400)]);
  fake.setMergeBase(INSTALLATION, FULL_NAME, { baseSha: commitSha(100), headSha: commitSha(400) }, commitSha(100));
  await expect(collectCommits(scope, stacked(100, 300))).rejects.toThrow(CommitListingMismatchError);
  expect(calls()).toEqual([
    'compareCommits',
    'listRepositoryCommits',
    'getPullRequest',
    'compareCommits',
    'listRepositoryCommits',
  ]);
});

test('a criss-cross history always ends as a mismatch: the walk takes a commit the count does not', async () => {
  const { fake, scope } = listingWorld();
  const crossed = [
    commit(1, { parents: [] }),
    commit(2),
    commit(3, { parents: [commitSha(1)] }),
    commit(4, { parents: [commitSha(2), commitSha(3)] }),
    commit(5, { parents: [commitSha(2), commitSha(3)] }),
    ...chain(6, 255),
  ];
  const pr = pullRequest(7, { baseSha: commitSha(4), headSha: commitSha(255), commitCount: 251 });
  fake.addPullRequest(INSTALLATION, FULL_NAME, pr);
  fake.setRepositoryCommits(INSTALLATION, FULL_NAME, [...crossed].reverse());
  fake.setMergeBase(INSTALLATION, FULL_NAME, { baseSha: commitSha(4), headSha: commitSha(255) }, commitSha(2));
  await expect(collectCommits(scope, pr)).rejects.toThrow(CommitListingMismatchError);
});

test('a listing that disagrees with the count is read again once the pull request has been read again, with its new count', async () => {
  const { fake, scope, calls } = listingWorld();
  fake.setPullRequestCommits(INSTALLATION, FULL_NAME, 7, chain(1, 3));
  fake.addPullRequest(INSTALLATION, FULL_NAME, stacked(0, 3));
  const collected = await collectCommits(scope, pullRequest(7, { headSha: commitSha(3), commitCount: 2 }));
  expect(collected).toMatchObject({ kind: 'listed', listing: 'complete' });
  expect(shasOf(collected)).toEqual(chain(1, 3).map((one) => one.sha));
  expect(calls()).toEqual(['listPullRequestCommits', 'getPullRequest', 'listPullRequestCommits']);
});

test('a listing that disagrees twice fails the job after exactly two listings and one more read of the pull request', async () => {
  const { fake, scope, calls } = listingWorld();
  const pr = stacked(0, 3);
  fake.addPullRequest(INSTALLATION, FULL_NAME, pr);
  fake.setPullRequestCommits(INSTALLATION, FULL_NAME, 7, chain(1, 2));
  await expect(collectCommits(scope, pr)).rejects.toThrow(CommitListingMismatchError);
  expect(calls()).toEqual(['listPullRequestCommits', 'getPullRequest', 'listPullRequestCommits']);
});

test('a commit listed twice is a mismatch even when the number of commits is right', async () => {
  const { fake, scope } = listingWorld();
  const pr = stacked(0, 2);
  fake.addPullRequest(INSTALLATION, FULL_NAME, pr);
  fake.setPullRequestCommits(INSTALLATION, FULL_NAME, 7, [commit(1), commit(1)]);
  await expect(collectCommits(scope, pr)).rejects.toThrow(CommitListingMismatchError);
});

test.each([
  ['a push moved the head', pullRequest(7, { headSha: commitSha(9), commitCount: 3 })],
  ['it was closed', pullRequest(7, { state: 'closed', headSha: commitSha(2), commitCount: 3 })],
] as const)(
  'when %s while the commits were read, the answer is superseded and nothing is listed again',
  async (_name, fresh) => {
    const { fake, scope, calls } = listingWorld();
    fake.addPullRequest(INSTALLATION, FULL_NAME, fresh);
    fake.setPullRequestCommits(INSTALLATION, FULL_NAME, 7, chain(1, 3));
    expect(await collectCommits(scope, stacked(0, 2))).toEqual({ kind: 'superseded' });
    expect(calls()).toEqual(['listPullRequestCommits', 'getPullRequest']);
  },
);

test('when the pull request is gone for GitHub the answer is superseded too', async () => {
  const { fake, scope } = listingWorld();
  fake.setPullRequestCommits(INSTALLATION, FULL_NAME, 7, chain(1, 3));
  expect(await collectCommits(scope, stacked(0, 2))).toEqual({ kind: 'superseded' });
});
