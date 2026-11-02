// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Octokit } from 'octokit';
import type { GithubId } from '../../../shared/github-id.ts';
import type {
  GitHubAppInfo,
  GitHubClient,
  GitHubInstallation,
  GitHubOrgMembership,
  GitHubRepository,
  GitHubRepositoryPermission,
} from '../../services/ports/github.ts';
import { fetchApp, fetchInstallation, fetchInstallations } from './octokit-app-calls.ts';
import type { Tokens, WithJwt } from './octokit-auth.ts';
import { Dispatch } from './octokit-dispatch.ts';
import {
  fetchMembership,
  fetchRepositories,
  fetchRepository,
  fetchRepositoryPermission,
} from './octokit-installation-calls.ts';
import type { RateLimiter } from './rate-limiter.ts';

// The Octokit adapter of the GitHub client port (E05-S04). The App-level methods are signed with the App JWT (and so
// inherit the key fallback and the identity check of E05-S02); the installation-level ones carry the installation's token
// (E05-S03), which the token provider refuses unless the instance serves the installation. Every request runs through the
// rate limiter (E05-S05) in the lane of its installation, or in the App's lane when it is signed with the JWT.

/**
 * A name GitHub can hold as an organisation or a login (letters, digits, `-`, `_`). Anything else, a `/` or a `..` above
 * all, cannot be a member, and is not allowed anywhere near a path.
 */
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

/**
 * A name GitHub can hold as a repository: letters, digits, `-`, `_` and `.` (a name may start with a dot, as `.github`
 * does), up to 100 characters, and never `.` or `..`, which would climb out of the path.
 */
const REPOSITORY_NAME = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;

export interface OctokitClientOptions {
  readonly octokit: Octokit;
  readonly withJwt: WithJwt;
  readonly tokens: Tokens;
  readonly limiter: RateLimiter;
}

export class OctokitGitHubClient implements GitHubClient {
  readonly #dispatch: Dispatch;

  constructor(options: OctokitClientOptions) {
    this.#dispatch = new Dispatch(options);
  }

  getApp(): Promise<GitHubAppInfo> {
    return this.#dispatch.asApp(fetchApp);
  }

  getInstallation(githubInstallationId: GithubId): Promise<GitHubInstallation | null> {
    return this.#dispatch.asApp((channel, headers) => fetchInstallation(channel, headers, githubInstallationId));
  }

  listInstallations(): Promise<GitHubInstallation[]> {
    return this.#dispatch.asApp(fetchInstallations);
  }

  listInstallationRepositories(githubInstallationId: GithubId): Promise<GitHubRepository[]> {
    return this.#dispatch.asInstallation(githubInstallationId, fetchRepositories);
  }

  getRepositoryById(githubInstallationId: GithubId, githubRepoId: GithubId): Promise<GitHubRepository | null> {
    return this.#dispatch.asInstallation(githubInstallationId, (channel, headers) =>
      fetchRepository(channel, headers, githubRepoId),
    );
  }

  getOrgMembership(githubInstallationId: GithubId, org: string, login: string): Promise<GitHubOrgMembership | null> {
    // The installation is checked first, so a refused installation is refused whatever the names are.
    return this.#dispatch.asInstallation(githubInstallationId, (channel, headers) =>
      NAME.test(org) && NAME.test(login) ? fetchMembership(channel, headers, org, login) : Promise.resolve(null),
    );
  }

  getRepositoryPermission(
    githubInstallationId: GithubId,
    owner: string,
    repo: string,
    login: string,
  ): Promise<GitHubRepositoryPermission | null> {
    // The installation is checked first, as for the membership: a refused installation is refused whatever the names are.
    return this.#dispatch.asInstallation(githubInstallationId, (channel, headers) =>
      NAME.test(owner) && REPOSITORY_NAME.test(repo) && NAME.test(login)
        ? fetchRepositoryPermission(channel, headers, { owner, repo }, login)
        : Promise.resolve(null),
    );
  }
}
