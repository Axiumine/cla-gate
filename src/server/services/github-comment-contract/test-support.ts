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
import { commitSha } from '../github-pull-contract/test-support.ts';
import type { GitHubIssueComment, GitHubPullRequestRef } from '../ports/github.ts';

// The reads of the manual re-evaluation (E07-S07) in the contract of the GitHub client port: what the fake and the Octokit
// adapter both answer for a comment and for the pull requests of a commit. The shapes GitHub can send that a port type
// cannot hold (an author of a type nobody knows, an `issue_url` without a number) are in the adapter's own tests.

const ACME = 'acme/api';

/** A comment by user 7 on pull request 7 whose text is the command. */
export function comment(commentId: number, overrides: Partial<GitHubIssueComment> = {}): GitHubIssueComment {
  return {
    id: id(commentId),
    issueNumber: 7,
    body: '/recheck',
    author: { id: id(7), type: 'User' },
    ...overrides,
  };
}

/** An open pull request whose head is `headSha`. */
export function pullRef(number: number, overrides: Partial<GitHubPullRequestRef> = {}): GitHubPullRequestRef {
  return { number, state: 'open', headSha: commitSha(2), ...overrides };
}

export const COMMENT_CASES: readonly ContractCase[] = [
  [
    'getIssueComment returns the text, the number of the issue it is on and its author by numeric id and type',
    async ({ client, addInstallation, addIssueComment }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      addIssueComment(id(11), ACME, comment(5001, { body: 'Please\r\n/recheck\r\n', issueNumber: 12 }));
      addIssueComment(id(11), ACME, comment(5002, { author: { id: id(9), type: 'Bot' } }));
      expect(await client.getIssueComment(id(11), ACME, id(5001))).toEqual(
        comment(5001, { body: 'Please\r\n/recheck\r\n', issueNumber: 12 }),
      );
      expect((await client.getIssueComment(id(11), ACME, id(5002)))?.author).toEqual({ id: id(9), type: 'Bot' });
    },
  ],
  [
    'getIssueComment returns an author of a kind the platform has no word for as Other, which is no bot',
    async ({ client, addInstallation, addIssueComment }) => {
      addInstallation(installation(11, 'acme'));
      addIssueComment(id(11), ACME, comment(5001, { author: { id: id(9), type: 'Other' } }));
      expect((await client.getIssueComment(id(11), ACME, id(5001)))?.author).toEqual({ id: id(9), type: 'Other' });
    },
  ],
  [
    'getIssueComment returns a comment GitHub shows no author for, with a null author',
    async ({ client, addInstallation, addIssueComment }) => {
      addInstallation(installation(11, 'acme'));
      addIssueComment(id(11), ACME, comment(5001, { author: null }));
      expect(await client.getIssueComment(id(11), ACME, id(5001))).toEqual(comment(5001, { author: null }));
    },
  ],
  [
    'getIssueComment treats the repository name without regard to case, as GitHub does',
    async ({ client, addInstallation, addIssueComment }) => {
      addInstallation(installation(11, 'acme'));
      addIssueComment(id(11), ACME, comment(5001));
      expect(await client.getIssueComment(id(11), 'ACME/Api', id(5001))).toEqual(comment(5001));
    },
  ],
  [
    'getIssueComment resolves null for a comment nobody wrote or somebody deleted, one of another installation or repository, and a name GitHub cannot hold',
    async ({ client, addInstallation, addIssueComment }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      addInstallation(installation(12, 'globex'), [repository(201, 'globex/api')]);
      addIssueComment(id(12), 'globex/api', comment(5002));
      addIssueComment(id(11), 'acme/other', comment(5003));
      expect(await client.getIssueComment(id(11), ACME, id(5001))).toBeNull();
      expect(await client.getIssueComment(id(11), ACME, id(5002))).toBeNull();
      expect(await client.getIssueComment(id(11), 'globex/api', id(5002))).toBeNull();
      expect(await client.getIssueComment(id(11), ACME, id(5003))).toBeNull();
      for (const name of ['acme', 'acme/', '/api', 'acme/../api', 'acme/api/x', 'acme/a b', '../api', 'acme/..']) {
        expect(await client.getIssueComment(id(11), name, id(5001))).toBeNull();
      }
    },
  ],
  [
    'listPullRequestsForCommit returns the number, state and head SHA of each pull request, open or closed, in order',
    async ({ client, addInstallation, setCommitPullRequests }) => {
      addInstallation(installation(11, 'acme'));
      const pulls = [pullRef(9), pullRef(7, { state: 'closed' }), pullRef(8, { headSha: commitSha(5) })];
      setCommitPullRequests(id(11), ACME, commitSha(2), pulls);
      expect(await client.listPullRequestsForCommit(id(11), ACME, commitSha(2))).toEqual(pulls);
    },
  ],
  [
    'listPullRequestsForCommit returns an empty list for a commit nobody knows, one of another installation or repository, and a name or a SHA GitHub cannot hold',
    async ({ client, addInstallation, setCommitPullRequests }) => {
      addInstallation(installation(11, 'acme'));
      addInstallation(installation(12, 'globex'));
      setCommitPullRequests(id(12), ACME, commitSha(2), [pullRef(7)]);
      setCommitPullRequests(id(11), 'acme/other', commitSha(2), [pullRef(7)]);
      setCommitPullRequests(id(11), ACME, commitSha(2), [pullRef(7)]);
      expect(await client.listPullRequestsForCommit(id(11), ACME, commitSha(3))).toEqual([]);
      expect(await client.listPullRequestsForCommit(id(11), 'globex/api', commitSha(2))).toEqual([]);
      for (const name of ['acme', '../api', 'acme/..', 'acme/a b']) {
        expect(await client.listPullRequestsForCommit(id(11), name, commitSha(2))).toEqual([]);
      }
      for (const sha of ['main', 'HEAD~1', `${commitSha(2)}/pulls`, commitSha(0xabc).toUpperCase(), '']) {
        expect(await client.listPullRequestsForCommit(id(11), ACME, sha)).toEqual([]);
      }
    },
  ],
  [
    'the reads of the manual re-evaluation answer a view with a signal that has not aborted, and send nothing once it has',
    async ({ client, addInstallation, addIssueComment, setCommitPullRequests, reached }) => {
      addInstallation(installation(11, 'acme'));
      addIssueComment(id(11), ACME, comment(5001));
      setCommitPullRequests(id(11), ACME, commitSha(2), [pullRef(7)]);
      const live = client.withSignal(new AbortController().signal);
      expect(await live.getIssueComment(id(11), ACME, id(5001))).toEqual(comment(5001));
      expect(await live.listPullRequestsForCommit(id(11), ACME, commitSha(2))).toEqual([pullRef(7)]);
      const before = reached();
      const reason = new Error('the job was aborted');
      const aborted = client.withSignal(AbortSignal.abort(reason));
      for (const call of [
        () => aborted.getIssueComment(id(11), ACME, id(5001)),
        () => aborted.listPullRequestsForCommit(id(11), ACME, commitSha(2)),
      ]) {
        await expect(call()).rejects.toBe(reason);
      }
      expect(reached()).toBe(before);
    },
  ],
  [
    'the reads of the manual re-evaluation are refused for an installation the gate refuses, gone for one GitHub no longer has, and suspended for a suspended one',
    async ({ client, addInstallation, ...world }) => {
      addInstallation(installation(11, 'acme'));
      addInstallation(installation(12, 'globex'));
      await expectInstallationRefusals(world, (installationId) => [
        () => client.getIssueComment(id(installationId), ACME, id(5001)),
        () => client.listPullRequestsForCommit(id(installationId), ACME, commitSha(2)),
      ]);
    },
  ],
];
