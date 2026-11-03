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
import { GitHubNotFoundError } from '../ports/github-errors.ts';

// The reads of the manual re-evaluation (E07-S07) in the contract of the GitHub client port: what the fake and the Octokit
// adapter both answer for a comment and for the pull requests of a commit; (E09-S06) the rewrite of a comment; and (E09-S07) the
// listing of a conversation and the posting of a comment. The shapes GitHub can send that a port type cannot hold (an author of a
// type nobody knows, an `issue_url` without a number, a `performed_via_github_app` without an id) are in the adapter's own tests.

const ACME = 'acme/api';

/** A comment by user 7 on pull request 7 whose text is the command. */
export function comment(commentId: number, overrides: Partial<GitHubIssueComment> = {}): GitHubIssueComment {
  return {
    id: id(commentId),
    issueNumber: 7,
    body: '/recheck',
    author: { id: id(7), type: 'User' },
    appId: null,
    ...overrides,
  };
}

/** The App both implementations post as (`GET /app`). */
const APP = id(4242);

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
  [
    'updateIssueComment rewrites the text of a comment, returns it with the issue it is on and its author, and the next read shows the new text',
    async ({ client, addInstallation, addIssueComment }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      addIssueComment(
        id(11),
        ACME,
        comment(5001, { body: 'old', issueNumber: 12, author: { id: id(9), type: 'Bot' } }),
      );
      addIssueComment(id(11), ACME, comment(5002));
      const rewritten = comment(5001, { body: 'new text', issueNumber: 12, author: { id: id(9), type: 'Bot' } });
      expect(await client.updateIssueComment(id(11), 'ACME/Api', id(5001), 'new text')).toEqual(rewritten);
      expect(await client.getIssueComment(id(11), ACME, id(5001))).toEqual(rewritten);
      expect(await client.getIssueComment(id(11), ACME, id(5002))).toEqual(comment(5002));
    },
  ],
  [
    'updateIssueComment throws not found for a comment nobody wrote or somebody deleted, one of another installation or repository, a repository the installation does not reach and a name GitHub cannot hold',
    async ({ client, addInstallation, addIssueComment }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      addInstallation(installation(12, 'globex'), [repository(201, 'globex/api')]);
      addIssueComment(id(12), 'globex/api', comment(5002));
      addIssueComment(id(11), 'acme/other', comment(5003));
      const refused = [
        [ACME, 5001],
        [ACME, 5002],
        ['globex/api', 5002],
        ['acme/other', 5003],
        ...['acme', 'acme/', '/api', 'acme/../api', 'acme/api/x', 'acme/a b', '../api', 'acme/..'].map(
          (name) => [name, 5001] as const,
        ),
      ] as const;
      for (const [name, commentId] of refused) {
        await expect(client.updateIssueComment(id(11), name, id(commentId), 'x')).rejects.toBeInstanceOf(
          GitHubNotFoundError,
        );
      }
      expect(await client.getIssueComment(id(12), 'globex/api', id(5002))).toEqual(comment(5002));
    },
  ],
  [
    'updateIssueComment answers a view with a signal that has not aborted, and sends nothing once it has',
    async ({ client, addInstallation, addIssueComment, reached }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      addIssueComment(id(11), ACME, comment(5001));
      const live = client.withSignal(new AbortController().signal);
      expect((await live.updateIssueComment(id(11), ACME, id(5001), 'again')).body).toBe('again');
      const before = reached();
      const reason = new Error('the job was aborted');
      await expect(
        client.withSignal(AbortSignal.abort(reason)).updateIssueComment(id(11), ACME, id(5001), 'never'),
      ).rejects.toBe(reason);
      expect(reached()).toBe(before);
    },
  ],
  [
    'updateIssueComment is refused for an installation the gate refuses, gone for one GitHub no longer has, and suspended for a suspended one',
    async ({ client, addInstallation, ...world }) => {
      addInstallation(installation(11, 'acme'));
      addInstallation(installation(12, 'globex'));
      await expectInstallationRefusals(world, (installationId) => [
        () => client.updateIssueComment(id(installationId), ACME, id(5001), 'x'),
      ]);
    },
  ],
  [
    'listIssueComments returns the comments of one issue oldest first, each with its author and the App it was posted through, and none of another issue, repository or installation',
    async ({ client, addInstallation, addIssueComment }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      addInstallation(installation(12, 'globex'), [repository(201, ACME)]);
      addIssueComment(id(11), ACME, comment(5003, { appId: APP, author: { id: id(9), type: 'Bot' } }));
      addIssueComment(id(11), ACME, comment(5001));
      addIssueComment(id(11), ACME, comment(5002, { issueNumber: 8 }));
      addIssueComment(id(11), 'acme/other', comment(5004));
      addIssueComment(id(12), ACME, comment(5005));
      expect(await client.listIssueComments(id(11), 'ACME/Api', 7, 1)).toEqual({
        comments: [comment(5001), comment(5003, { appId: APP, author: { id: id(9), type: 'Bot' } })],
        last: true,
      });
      expect(await client.listIssueComments(id(11), ACME, 9, 1)).toEqual({ comments: [], last: true });
    },
  ],
  [
    'listIssueComments pages 100 comments to a page, says which page is the last, and answers an empty last page past the end',
    async ({ client, addInstallation, addIssueComment }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      for (let commentId = 6001; commentId <= 6150; commentId += 1) {
        addIssueComment(id(11), ACME, comment(commentId));
      }
      const [first, second, third] = await Promise.all(
        [1, 2, 3].map((page) => client.listIssueComments(id(11), ACME, 7, page)),
      );
      expect(first?.comments.map((each) => each.id)).toEqual(Array.from({ length: 100 }, (_, i) => 6001 + i));
      expect(first?.last).toBe(false);
      expect(second?.comments.map((each) => each.id)).toEqual(Array.from({ length: 50 }, (_, i) => 6101 + i));
      expect(second?.last).toBe(true);
      expect(third).toEqual({ comments: [], last: true });
    },
  ],
  [
    'listIssueComments throws not found for a repository the installation does not reach, one of another installation and a name GitHub cannot hold',
    async ({ client, addInstallation, addIssueComment }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      addInstallation(installation(12, 'globex'), [repository(201, 'globex/api')]);
      addIssueComment(id(12), 'globex/api', comment(5002));
      for (const name of ['globex/api', 'acme/other', 'acme', 'acme/', '/api', 'acme/../api', 'acme/api/x', '../api']) {
        await expect(client.listIssueComments(id(11), name, 7, 1)).rejects.toBeInstanceOf(GitHubNotFoundError);
      }
    },
  ],
  [
    'createIssueComment posts a comment as the App on the issue, returns it with the issue, the text, a bot as author and the App, and the comment can be read and listed',
    async ({ client, addInstallation, addIssueComment }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      addIssueComment(id(11), ACME, comment(5001));
      const first = await client.createIssueComment(id(11), 'ACME/Api', 7, 'first text');
      const second = await client.createIssueComment(id(11), ACME, 7, 'second text');
      expect(first).toMatchObject({ issueNumber: 7, body: 'first text', author: { type: 'Bot' }, appId: APP });
      expect(second).toMatchObject({ issueNumber: 7, body: 'second text', appId: APP });
      expect(second.id).toBeGreaterThan(first.id);
      expect(await client.getIssueComment(id(11), ACME, first.id)).toEqual(first);
      expect(await client.listIssueComments(id(11), ACME, 7, 1)).toEqual({
        comments: [comment(5001), first, second],
        last: true,
      });
      expect(await client.listIssueComments(id(11), ACME, 8, 1)).toEqual({ comments: [], last: true });
    },
  ],
  [
    'createIssueComment throws not found for a repository the installation does not reach, one of another installation and a name GitHub cannot hold, and posts nothing',
    async ({ client, addInstallation }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      addInstallation(installation(12, 'globex'), [repository(201, 'globex/api')]);
      for (const name of ['globex/api', 'acme/other', 'acme', 'acme/', '/api', 'acme/../api', 'acme/api/x', '../api']) {
        await expect(client.createIssueComment(id(11), name, 7, 'x')).rejects.toBeInstanceOf(GitHubNotFoundError);
      }
      expect(await client.listIssueComments(id(11), ACME, 7, 1)).toEqual({ comments: [], last: true });
      expect(await client.listIssueComments(id(12), 'globex/api', 7, 1)).toEqual({ comments: [], last: true });
    },
  ],
  [
    'listIssueComments and createIssueComment answer a view with a signal that has not aborted, and send nothing once it has',
    async ({ client, addInstallation, reached }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      const live = client.withSignal(new AbortController().signal);
      expect((await live.createIssueComment(id(11), ACME, 7, 'again')).body).toBe('again');
      expect((await live.listIssueComments(id(11), ACME, 7, 1)).comments).toHaveLength(1);
      const before = reached();
      const reason = new Error('the job was aborted');
      const aborted = client.withSignal(AbortSignal.abort(reason));
      for (const call of [
        () => aborted.listIssueComments(id(11), ACME, 7, 1),
        () => aborted.createIssueComment(id(11), ACME, 7, 'never'),
      ]) {
        await expect(call()).rejects.toBe(reason);
      }
      expect(reached()).toBe(before);
    },
  ],
  [
    'listIssueComments and createIssueComment are refused for an installation the gate refuses, gone for one GitHub no longer has, and suspended for a suspended one',
    async ({ client, addInstallation, ...world }) => {
      addInstallation(installation(11, 'acme'));
      addInstallation(installation(12, 'globex'));
      await expectInstallationRefusals(world, (installationId) => [
        () => client.listIssueComments(id(installationId), ACME, 7, 1),
        () => client.createIssueComment(id(installationId), ACME, 7, 'x'),
      ]);
    },
  ],
];
