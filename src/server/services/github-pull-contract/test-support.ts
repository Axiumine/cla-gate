// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect } from 'vitest';
import {
  type ContractCase,
  expectInstallationRefusals,
  id,
  installation,
  repository,
} from '../github-contract/test-support.ts';
import type { GitHubAccountRef, GitHubCommit, GitHubPullRequest } from '../ports/github.ts';
import { GitHubNotFoundError } from '../ports/github-errors.ts';

// The reads of the evaluation job (E07-S10) in the contract of the GitHub client port: what the fake and the Octokit
// adapter both answer for a pull request, its commits, the history behind a head and a comparison. The shapes GitHub
// can send that a port type cannot hold (`{}` for an author, a missing id) are in the adapter's own tests.

/** A lower-case 40-character commit SHA made from a number. */
export const commitSha = (n: number): string => n.toString(16).padStart(40, '0');

export function account(n: number, type: GitHubAccountRef['type'] = 'User'): GitHubAccountRef {
  return { id: id(n), login: `user-${n}`, type };
}

/** An open pull request by user 7 with 2 commits, head `commitSha(2)` on base `commitSha(1)`. */
export function pullRequest(number: number, overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number,
    state: 'open',
    draft: false,
    headSha: commitSha(2),
    baseSha: commitSha(1),
    opener: account(7),
    commitCount: 2,
    ...overrides,
  };
}

/** A commit of the history `commitSha(n - 1) <- commitSha(n)` by user `n`, committed by the same account. */
export function commit(n: number, overrides: Partial<GitHubCommit> = {}): GitHubCommit {
  return {
    sha: commitSha(n),
    parents: [commitSha(n - 1)],
    author: account(n),
    committer: account(n),
    message: `change ${n}`,
    rawAuthor: { name: `Author ${n}`, email: `author${n}@example.org` },
    rawCommitter: { name: `Author ${n}`, email: `author${n}@example.org` },
    ...overrides,
  };
}

/** `count` commits with consecutive numbers from `first`. */
const history = (first: number, count: number): GitHubCommit[] =>
  Array.from({ length: count }, (_, index) => commit(first + index));

const ACME = 'acme/api';

export const PULL_CASES: readonly ContractCase[] = [
  [
    'getPullRequest returns the state, the draft flag, both SHAs, the opener and the commit count',
    async ({ client, addInstallation, addPullRequest }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      addPullRequest(id(11), ACME, pullRequest(7, { draft: true, opener: account(9, 'Bot'), commitCount: 3 }));
      addPullRequest(id(11), ACME, pullRequest(8, { state: 'closed' }));
      expect(await client.getPullRequest(id(11), ACME, 7)).toEqual(
        pullRequest(7, { draft: true, opener: account(9, 'Bot'), commitCount: 3 }),
      );
      expect((await client.getPullRequest(id(11), ACME, 8))?.state).toBe('closed');
    },
  ],
  [
    'getPullRequest treats the repository name without regard to case, as GitHub does',
    async ({ client, addInstallation, addPullRequest }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      addPullRequest(id(11), ACME, pullRequest(7));
      expect(await client.getPullRequest(id(11), 'ACME/Api', 7)).toEqual(pullRequest(7));
    },
  ],
  [
    'getPullRequest resolves null for a pull request nobody opened, one of another installation, and a name GitHub cannot hold',
    async ({ client, addInstallation, addPullRequest }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      addInstallation(installation(12, 'globex'), [repository(201, 'globex/api')]);
      addPullRequest(id(12), 'globex/api', pullRequest(7));
      expect(await client.getPullRequest(id(11), ACME, 7)).toBeNull();
      expect(await client.getPullRequest(id(11), 'globex/api', 7)).toBeNull();
      for (const name of [
        'acme',
        'acme/',
        '/api',
        'acme/../api',
        'acme/api/x',
        'acme/a b',
        '../api',
        'acme/..',
        'acme/.',
      ]) {
        expect(await client.getPullRequest(id(11), name, 7)).toBeNull();
      }
    },
  ],
  [
    'listPullRequestCommits returns the commits with their linked accounts, parents, messages and raw identities',
    async ({ client, addInstallation, setPullRequestCommits }) => {
      addInstallation(installation(11, 'acme'));
      const unlinked = commit(2, { author: null, committer: null, parents: [commitSha(1), commitSha(3)] });
      setPullRequestCommits(id(11), ACME, 7, [commit(1, { committer: account(19_864_447) }), unlinked]);
      const page = await client.listPullRequestCommits(id(11), ACME, 7, 1);
      expect(page).toEqual({
        commits: [commit(1, { committer: account(19_864_447) }), unlinked],
        last: true,
      });
    },
  ],
  [
    'listPullRequestCommits serves 100 commits a page and says which page is the last',
    async ({ client, addInstallation, setPullRequestCommits }) => {
      addInstallation(installation(11, 'acme'));
      setPullRequestCommits(id(11), ACME, 7, history(1, 250));
      const pages = [
        await client.listPullRequestCommits(id(11), ACME, 7, 1),
        await client.listPullRequestCommits(id(11), ACME, 7, 2),
        await client.listPullRequestCommits(id(11), ACME, 7, 3),
        await client.listPullRequestCommits(id(11), ACME, 7, 4),
      ];
      expect(pages.map((page) => [page.commits.length, page.last])).toEqual([
        [100, false],
        [100, false],
        [50, true],
        [0, true],
      ]);
      expect(pages[2]?.commits[0]).toEqual(commit(201));
    },
  ],
  [
    'listPullRequestCommits rejects with GitHubNotFoundError for a pull request nobody opened and for a name GitHub cannot hold',
    async ({ client, addInstallation }) => {
      addInstallation(installation(11, 'acme'));
      await expect(client.listPullRequestCommits(id(11), ACME, 7, 1)).rejects.toBeInstanceOf(GitHubNotFoundError);
      await expect(client.listPullRequestCommits(id(11), '../orgs/other', 7, 1)).rejects.toBeInstanceOf(
        GitHubNotFoundError,
      );
    },
  ],
  [
    'listRepositoryCommits serves the history behind a head 100 commits a page and says which page is the last',
    async ({ client, addInstallation, setRepositoryCommits }) => {
      addInstallation(installation(11, 'acme'));
      setRepositoryCommits(id(11), ACME, history(1, 150));
      const first = await client.listRepositoryCommits(id(11), ACME, commitSha(150), 1);
      const second = await client.listRepositoryCommits(id(11), ACME, commitSha(150), 2);
      expect([first.commits.length, first.last, second.commits.length, second.last]).toEqual([100, false, 50, true]);
      expect(second.commits[49]).toEqual(commit(150));
    },
  ],
  [
    'listRepositoryCommits rejects with GitHubNotFoundError for a repository nobody has and for a name or a SHA GitHub cannot hold',
    async ({ client, addInstallation, setRepositoryCommits }) => {
      addInstallation(installation(11, 'acme'));
      await expect(client.listRepositoryCommits(id(11), ACME, commitSha(5), 1)).rejects.toBeInstanceOf(
        GitHubNotFoundError,
      );
      setRepositoryCommits(id(11), ACME, history(1, 3));
      await expect(client.listRepositoryCommits(id(11), 'acme/../x', commitSha(5), 1)).rejects.toBeInstanceOf(
        GitHubNotFoundError,
      );
      await expect(client.listRepositoryCommits(id(11), ACME, 'main?x=1', 1)).rejects.toBeInstanceOf(
        GitHubNotFoundError,
      );
    },
  ],
  [
    'compareCommits returns the merge base of the two commits',
    async ({ client, addInstallation, setMergeBase }) => {
      addInstallation(installation(11, 'acme'));
      setMergeBase(id(11), ACME, { baseSha: commitSha(9), headSha: commitSha(5) }, commitSha(4));
      expect(await client.compareCommits(id(11), ACME, commitSha(9), commitSha(5))).toEqual({
        mergeBaseSha: commitSha(4),
      });
    },
  ],
  [
    'compareCommits rejects with GitHubNotFoundError for commits nobody compared and for a name or a SHA GitHub cannot hold',
    async ({ client, addInstallation }) => {
      addInstallation(installation(11, 'acme'));
      for (const call of [
        () => client.compareCommits(id(11), ACME, commitSha(9), commitSha(5)),
        () => client.compareCommits(id(11), '../x', commitSha(9), commitSha(5)),
        () => client.compareCommits(id(11), ACME, 'main', commitSha(5)),
        () => client.compareCommits(id(11), ACME, commitSha(9), 'a/b'),
      ]) {
        await expect(call()).rejects.toBeInstanceOf(GitHubNotFoundError);
      }
    },
  ],
  [
    'the reads of the evaluation answer a view with a signal that has not aborted, and send nothing once it has',
    async ({ client, addInstallation, addPullRequest, setPullRequestCommits, reached }) => {
      addInstallation(installation(11, 'acme'));
      addPullRequest(id(11), ACME, pullRequest(7));
      setPullRequestCommits(id(11), ACME, 7, [commit(1)]);
      const live = client.withSignal(new AbortController().signal);
      expect(await live.getPullRequest(id(11), ACME, 7)).toEqual(pullRequest(7));
      expect((await live.listPullRequestCommits(id(11), ACME, 7, 1)).commits).toEqual([commit(1)]);
      const before = reached();
      const reason = new Error('the job was aborted');
      const aborted = client.withSignal(AbortSignal.abort(reason));
      for (const call of [
        () => aborted.getPullRequest(id(11), ACME, 7),
        () => aborted.listPullRequestCommits(id(11), ACME, 7, 1),
        () => aborted.listRepositoryCommits(id(11), ACME, commitSha(1), 1),
        () => aborted.compareCommits(id(11), ACME, commitSha(1), commitSha(2)),
      ]) {
        await expect(call()).rejects.toBe(reason);
      }
      expect(reached()).toBe(before);
    },
  ],
  [
    'the reads of the evaluation are refused for an installation the gate refuses, gone for one GitHub no longer has, and suspended for a suspended one',
    async ({ client, addInstallation, ...world }) => {
      addInstallation(installation(11, 'acme'));
      addInstallation(installation(12, 'globex'));
      await expectInstallationRefusals(world, (installationId) => [
        () => client.getPullRequest(id(installationId), ACME, 7),
        () => client.listPullRequestCommits(id(installationId), ACME, 7, 1),
        () => client.listRepositoryCommits(id(installationId), ACME, commitSha(1), 1),
        () => client.compareCommits(id(installationId), ACME, commitSha(1), commitSha(2)),
      ]);
    },
  ],
];
