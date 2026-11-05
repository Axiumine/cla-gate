// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import type { GitHubClient, GitHubUserAccount } from '../../services/ports/github.ts';
import { fetchOrganizationAccount, fetchUserAccount } from './octokit-account-calls.ts';
import { OctokitCheckRuns } from './octokit-check-runs.ts';

// The lookup of an account by login (E14-S06) and of an organisation by login (E21-S03) of the Octokit adapter, kept in a class of its own between `OctokitCheckRuns` and
// `OctokitGitHubClient`, so that no file of the adapter grows past what is easy to read.

type UserAccountCalls = Pick<GitHubClient, 'getUserAccount' | 'getOrganizationAccount'>;

export class OctokitUserAccounts extends OctokitCheckRuns implements UserAccountCalls {
  getUserAccount(githubInstallationId: GithubId, login: string): Promise<GitHubUserAccount | null> {
    // The installation is checked first, as for the membership; a login that cannot be one is answered without a request.
    return this.dispatch.asInstallation(githubInstallationId, (channel, headers) =>
      fetchUserAccount(channel, headers, login),
    );
  }

  getOrganizationAccount(githubInstallationId: GithubId, login: string): Promise<GitHubUserAccount | null> {
    return this.dispatch.asInstallation(githubInstallationId, (channel, headers) =>
      fetchOrganizationAccount(channel, headers, login),
    );
  }
}
