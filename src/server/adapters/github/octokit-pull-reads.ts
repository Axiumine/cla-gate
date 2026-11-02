// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import type { GitHubClient } from '../../services/ports/github.ts';
import type { Dispatch } from './octokit-dispatch.ts';
import {
  fetchMergeBase,
  fetchPullRequest,
  fetchPullRequestCommits,
  fetchRepositoryCommits,
} from './octokit-pull-calls.ts';

// The reads of the evaluation job (E07-S10) of the Octokit adapter: a pull request, its commits, the history behind a head and
// the merge base of two commits. They are the installation-level methods of the port that the evaluation needs, kept in a
// class of their own that `OctokitGitHubClient` extends, so that no file of the adapter grows past what is easy to read.

type PullReads = Pick<
  GitHubClient,
  'getPullRequest' | 'listPullRequestCommits' | 'listRepositoryCommits' | 'compareCommits'
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
}
