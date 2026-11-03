// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import type { GitHubClient, GitHubIssueComment, GitHubIssueCommentPage } from '../../services/ports/github.ts';
import { fetchIssueCommentPage, patchIssueComment, postIssueComment } from './octokit-conversation-calls.ts';
import { OctokitPullReads } from './octokit-pull-reads.ts';

// The calls on the conversation of a pull request (E09-S06, E09-S07) of the Octokit adapter: the rewrite of a comment the platform
// wrote, the page of a conversation it looks in, and the creation of a comment. They are installation-level methods of the port,
// kept in a class of their own between `OctokitPullReads` and `OctokitCheckRuns`, so that no file of the adapter grows past what
// is easy to read.

type CommentCalls = Pick<GitHubClient, 'updateIssueComment' | 'listIssueComments' | 'createIssueComment'>;

export class OctokitCommentWrites extends OctokitPullReads implements CommentCalls {
  updateIssueComment(
    githubInstallationId: GithubId,
    fullName: string,
    commentId: GithubId,
    body: string,
  ): Promise<GitHubIssueComment> {
    return this.dispatch.asInstallation(githubInstallationId, (channel, headers) =>
      patchIssueComment(channel, headers, { fullName, commentId }, body),
    );
  }

  listIssueComments(
    githubInstallationId: GithubId,
    fullName: string,
    issueNumber: number,
    page: number,
  ): Promise<GitHubIssueCommentPage> {
    return this.dispatch.asInstallation(githubInstallationId, (channel, headers) =>
      fetchIssueCommentPage(channel, headers, { fullName, issueNumber, page }),
    );
  }

  createIssueComment(
    githubInstallationId: GithubId,
    fullName: string,
    issueNumber: number,
    body: string,
  ): Promise<GitHubIssueComment> {
    return this.dispatch.asInstallation(githubInstallationId, (channel, headers) =>
      postIssueComment(channel, headers, { fullName, issueNumber }, body),
    );
  }
}
