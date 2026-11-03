// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import type { GitHubClient, GitHubIssueComment } from '../../services/ports/github.ts';
import { patchIssueComment } from './octokit-comment-calls.ts';
import { OctokitPullReads } from './octokit-pull-reads.ts';

// The writes to the conversation of a pull request (E09-S06) of the Octokit adapter: the rewrite of a comment the platform wrote.
// They are installation-level methods of the port, kept in a class of their own between `OctokitPullReads` and
// `OctokitCheckRuns`, so that no file of the adapter grows past what is easy to read.

type CommentWrites = Pick<GitHubClient, 'updateIssueComment'>;

export class OctokitCommentWrites extends OctokitPullReads implements CommentWrites {
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
}
