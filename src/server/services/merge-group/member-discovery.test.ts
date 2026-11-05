// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { FULL_NAME, githubWorld, INSTALLATION } from '../evaluate-pr/test-support.ts';
import { commit, commitSha } from '../github-pull-contract/test-support.ts';
import type { GitHubCommit } from '../ports/github.ts';
import { discoverMembers } from './member-discovery.ts';
import { BASE, groupCommit } from './test-support.ts';

// Which pull requests a group holds (E22-S01): the one the name of the branch gives, completed by the pull requests of the commits of
// the range when it holds more than one commit, and every doubt is `undetermined`.

const HEAD = groupCommit(9);

/** A chain of `count` commits on top of the base, the last one being `HEAD`'s group, newest first as GitHub lists them. */
function chain(count: number, head = HEAD): GitHubCommit[] {
  const shas = Array.from({ length: count }, (_, index) => (index === count - 1 ? head : groupCommit(100 + index)));
  return shas
    .map((sha, index) => commit(index + 1, { sha, parents: [index === 0 ? BASE : (shas[index - 1] ?? BASE)] }))
    .toReversed();
}

/** The GitHub of the world with a range of `count` commits before `HEAD`, and the scope the discovery reads it with. */
function scene(count: number) {
  const fake = githubWorld();
  const commits = chain(count);
  fake.setRepositoryCommits(INSTALLATION, FULL_NAME, commits);
  fake.setMergeBase(INSTALLATION, FULL_NAME, { baseSha: BASE, headSha: HEAD }, BASE);
  return { fake, commits, scope: { github: fake, githubInstallationId: INSTALLATION, fullName: FULL_NAME } };
}

const range = (tipPrNumber?: number) => ({ baseSha: BASE, headSha: HEAD, tipPrNumber });
const lookups = (fake: ReturnType<typeof githubWorld>) =>
  fake.calls.filter((call) => call.method === 'listPullRequestsForCommit').length;

test('a range of one commit is the pull request the name of the branch gives, and no commit is looked up', async () => {
  const { fake, scope } = scene(1);
  expect(await discoverMembers(scope, range(41))).toEqual({ kind: 'members', numbers: [41] });
  expect(lookups(fake)).toBe(0);
});

test('a range of one commit with no number in the name of the branch holds no pull request that can be named', async () => {
  const { scope } = scene(1);
  expect(await discoverMembers(scope, range())).toEqual({ kind: 'undetermined' });
});

test('a range of an empty history is only the pull request of the name, and the group is still read', async () => {
  const { fake, scope } = scene(1);
  fake.setMergeBase(INSTALLATION, FULL_NAME, { baseSha: BASE, headSha: HEAD }, HEAD);
  expect(await discoverMembers(scope, range(7))).toEqual({ kind: 'members', numbers: [7] });
});

test('a range of more than one commit adds the open pull requests of each commit to the one of the name, in ascending order', async () => {
  const { fake, scope } = scene(3);
  fake.setCommitPullRequests(INSTALLATION, FULL_NAME, groupCommit(100), [
    { number: 12, state: 'open', headSha: commitSha(1) },
  ]);
  fake.setCommitPullRequests(INSTALLATION, FULL_NAME, groupCommit(101), [
    { number: 5, state: 'open', headSha: commitSha(2) },
    { number: 12, state: 'open', headSha: commitSha(1) },
  ]);
  fake.setCommitPullRequests(INSTALLATION, FULL_NAME, HEAD, [{ number: 30, state: 'open', headSha: commitSha(3) }]);
  expect(await discoverMembers(scope, range(30))).toEqual({ kind: 'members', numbers: [5, 12, 30] });
  expect(lookups(fake)).toBe(3);
});

test('a pull request that is closed is not a member of a group in the queue, and a commit with none adds none', async () => {
  const { fake, scope } = scene(2);
  fake.setCommitPullRequests(INSTALLATION, FULL_NAME, groupCommit(100), [
    { number: 3, state: 'closed', headSha: commitSha(1) },
  ]);
  expect(await discoverMembers(scope, range(8))).toEqual({ kind: 'members', numbers: [8] });
});

test('without a number in the name of the branch the lookup alone can name the group', async () => {
  const { fake, scope } = scene(2);
  fake.setCommitPullRequests(INSTALLATION, FULL_NAME, HEAD, [{ number: 6, state: 'open', headSha: commitSha(1) }]);
  expect(await discoverMembers(scope, range())).toEqual({ kind: 'members', numbers: [6] });
});

test('a group with nothing found by either rule is undetermined', async () => {
  const { scope } = scene(2);
  expect(await discoverMembers(scope, range())).toEqual({ kind: 'undetermined' });
});

test.each([
  [24, 'members', 25],
  [25, 'undetermined', 0],
])(
  'a range of %s commits that each have a pull request, with the one of the branch name, makes a group that is %s (members: %s)',
  async (commits, kind, members) => {
    const { fake, scope } = scene(commits);
    chain(commits).forEach((entry, index) => {
      fake.setCommitPullRequests(INSTALLATION, FULL_NAME, entry.sha, [
        { number: 1000 + index, state: 'open', headSha: commitSha(1) },
      ]);
    });
    const answer = await discoverMembers(scope, range(5));
    expect(answer.kind).toBe(kind);
    expect(answer.kind === 'members' ? answer.numbers : []).toHaveLength(members);
  },
);

test('a range of 250 commits is looked up and one of 251 is undetermined, with no lookup at all', async () => {
  const within = scene(250);
  expect(await discoverMembers(within.scope, range(41))).toEqual({ kind: 'members', numbers: [41] });
  expect(lookups(within.fake)).toBe(250);
  const beyond = scene(251);
  expect(await discoverMembers(beyond.scope, range(41))).toEqual({ kind: 'undetermined' });
  expect(lookups(beyond.fake)).toBe(0);
});

test('a history that goes past the limits of the walk is undetermined', async () => {
  const { scope } = scene(2001);
  expect(await discoverMembers(scope, range(41))).toEqual({ kind: 'undetermined' });
});

test('a history that does not add up (a parent GitHub does not list) is undetermined, never a group of one', async () => {
  const { fake, scope } = scene(1);
  fake.setRepositoryCommits(INSTALLATION, FULL_NAME, [commit(1, { sha: HEAD, parents: [commitSha(0xdead)] })]);
  expect(await discoverMembers(scope, range(41))).toEqual({ kind: 'undetermined' });
});

test('a commit GitHub does not have is not an answer: the error is thrown, so the job is retried', async () => {
  const { fake, scope } = scene(1);
  fake.setMergeBase(INSTALLATION, FULL_NAME, { baseSha: BASE, headSha: commitSha(0xbeef) }, BASE);
  await expect(discoverMembers(scope, { baseSha: BASE, headSha: commitSha(0xcafe), tipPrNumber: 1 })).rejects.toThrow();
});
