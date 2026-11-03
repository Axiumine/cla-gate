// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import type { CheckRunWrite, GitHubCheckRun, GitHubClient } from '../../services/ports/github.ts';
import { fetchCheckRun, fetchCheckRunsForRef } from './octokit-check-reads.ts';
import { patchCheckRun, postCheckRun } from './octokit-check-writes.ts';
import { OctokitCommentWrites } from './octokit-comment-writes.ts';

// The Check Run calls (E09-S05) of the Octokit adapter: create, update, read and list the runs of a commit. They are the
// installation-level methods of the port that the Check Run writer needs, kept in a class of their own between
// `OctokitCommentWrites` and `OctokitGitHubClient`, so that no file of the adapter grows past what is easy to read.

type CheckRunCalls = Pick<GitHubClient, 'createCheckRun' | 'updateCheckRun' | 'getCheckRun' | 'listCheckRunsForRef'>;

export class OctokitCheckRuns extends OctokitCommentWrites implements CheckRunCalls {
  createCheckRun(
    githubInstallationId: GithubId,
    fullName: string,
    headSha: string,
    write: CheckRunWrite,
  ): Promise<GitHubCheckRun> {
    return this.dispatch.asInstallation(githubInstallationId, (channel, headers) =>
      postCheckRun(channel, headers, { fullName, headSha }, write),
    );
  }

  updateCheckRun(
    githubInstallationId: GithubId,
    fullName: string,
    checkRunId: GithubId,
    write: CheckRunWrite,
  ): Promise<GitHubCheckRun> {
    return this.dispatch.asInstallation(githubInstallationId, (channel, headers) =>
      patchCheckRun(channel, headers, { fullName, checkRunId }, write),
    );
  }

  getCheckRun(githubInstallationId: GithubId, fullName: string, checkRunId: GithubId): Promise<GitHubCheckRun | null> {
    return this.dispatch.asInstallation(githubInstallationId, (channel, headers) =>
      fetchCheckRun(channel, headers, fullName, checkRunId),
    );
  }

  listCheckRunsForRef(githubInstallationId: GithubId, fullName: string, headSha: string): Promise<GitHubCheckRun[]> {
    return this.dispatch.asInstallation(githubInstallationId, (channel, headers) =>
      fetchCheckRunsForRef(channel, headers, fullName, headSha),
    );
  }
}
