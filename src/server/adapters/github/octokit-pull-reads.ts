// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import type { GitHubClient } from '../../services/ports/github.ts';
import { fetchIssueComment, fetchPullRequestsForCommit } from './octokit-comment-calls.ts';
import { fetchCommit } from './octokit-commit-call.ts';
import type { Dispatch } from './octokit-dispatch.ts';
import {
  fetchMergeBase,
  fetchOpenPullRequests,
  fetchPullRequest,
  fetchPullRequestCommits,
  fetchRepositoryCommits,
} from './octokit-pull-calls.ts';

// The reads of the evaluation job (E07-S10) of the Octokit adapter: a pull request, its commits, the history behind a head and
// the merge base of two commits, (E07-S07) a comment and the pull requests of a commit, (E07-S08) the open pull requests
// of a repository, and (E15-S05) whether a repository has a commit. They are the installation-level methods of the port that the evaluation and the sweep need, kept in a class
// of their own that `OctokitGitHubClient` extends, so that no file of the adapter grows past what is easy to read.

type PullReads = Pick<
  GitHubClient,
  | 'getPullRequest'
  | 'getCommit'
  | 'listPullRequestCommits'
  | 'listRepositoryCommits'
  | 'compareCommits'
  | 'getIssueComment'
  | 'listPullRequestsForCommit'
  | 'listOpenPullRequests'
>;

export class OctokitPullReads implements PullReads {
  /** What every request of the adapter goes through: the token it carries, the lane it waits in and the signal it obeys. */
  protected readonly dispatch: Dispatch;

  constructor(dispatch: Dispatch) {
    this.dispatch = dispatch;
  }

  getPullRequest(githubInstallationId: GithubId, fullName: string, prNumber: number) {
    return this.dispatch.asInstallation(githubInstallationId, (channel, headers) =>
      fetchPullRequest(channel, headers, fullName, prNumber),
    );
  }

  getCommit(githubInstallationId: GithubId, fullName: string, sha: string) {
    return this.dispatch.asInstallation(githubInstallationId, (channel, headers) =>
      fetchCommit(channel, headers, fullName, sha),
    );
  }

  listOpenPullRequests(githubInstallationId: GithubId, fullName: string, page: number) {
    return this.dispatch.asInstallation(githubInstallationId, (channel, headers) =>
      fetchOpenPullRequests(channel, headers, { fullName, page }),
    );
  }

  listPullRequestCommits(githubInstallationId: GithubId, fullName: string, prNumber: number, page: number) {
    return this.dispatch.asInstallation(githubInstallationId, (channel, headers) =>
      fetchPullRequestCommits(channel, headers, { fullName, prNumber, page }),
    );
  }

  listRepositoryCommits(githubInstallationId: GithubId, fullName: string, headSha: string, page: number) {
    return this.dispatch.asInstallation(githubInstallationId, (channel, headers) =>
      fetchRepositoryCommits(channel, headers, { fullName, headSha, page }),
    );
  }

  compareCommits(githubInstallationId: GithubId, fullName: string, baseSha: string, headSha: string) {
    return this.dispatch.asInstallation(githubInstallationId, (channel, headers) =>
      fetchMergeBase(channel, headers, fullName, { baseSha, headSha }),
    );
  }

  getIssueComment(githubInstallationId: GithubId, fullName: string, commentId: GithubId) {
    return this.dispatch.asInstallation(githubInstallationId, (channel, headers) =>
      fetchIssueComment(channel, headers, fullName, commentId),
    );
  }

  listPullRequestsForCommit(githubInstallationId: GithubId, fullName: string, headSha: string) {
    return this.dispatch.asInstallation(githubInstallationId, (channel, headers) =>
      fetchPullRequestsForCommit(channel, headers, fullName, headSha),
    );
  }
}
