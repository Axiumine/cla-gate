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
} from '../../services/ports/github.ts';
import { fetchApp, fetchInstallation, fetchInstallations } from './octokit-app-calls.ts';
import { asApp, asInstallation, type Tokens, type WithJwt } from './octokit-auth.ts';
import { fetchMembership, fetchRepositories, fetchRepository } from './octokit-installation-calls.ts';

// The Octokit adapter of the GitHub client port (E05-S04). The App-level methods are signed with the App JWT (and so
// inherit the key fallback and the identity check of E05-S02); the installation-level ones carry the installation's token
// (E05-S03), which the token provider refuses unless the instance serves the installation.

/**
 * A name GitHub can hold as an organisation or a login (letters, digits, `-`, `_`). Anything else, a `/` or a `..` above
 * all, cannot be a member, and is not allowed anywhere near a path.
 */
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

export interface OctokitClientOptions {
  readonly octokit: Octokit;
  readonly withJwt: WithJwt;
  readonly tokens: Tokens;
}

export class OctokitGitHubClient implements GitHubClient {
  readonly #octokit: Octokit;
  readonly #withJwt: WithJwt;
  readonly #tokens: Tokens;

  constructor(options: OctokitClientOptions) {
    this.#octokit = options.octokit;
    this.#withJwt = options.withJwt;
    this.#tokens = options.tokens;
  }

  getApp(): Promise<GitHubAppInfo> {
    return asApp(this.#withJwt, (headers) => fetchApp(this.#octokit, headers));
  }

  getInstallation(githubInstallationId: GithubId): Promise<GitHubInstallation | null> {
    return asApp(this.#withJwt, (headers) => fetchInstallation(this.#octokit, headers, githubInstallationId));
  }

  listInstallations(): Promise<GitHubInstallation[]> {
    return asApp(this.#withJwt, (headers) => fetchInstallations(this.#octokit, headers));
  }

  listInstallationRepositories(githubInstallationId: GithubId): Promise<GitHubRepository[]> {
    return asInstallation(this.#tokens, githubInstallationId, (headers) => fetchRepositories(this.#octokit, headers));
  }

  getRepositoryById(githubInstallationId: GithubId, githubRepoId: GithubId): Promise<GitHubRepository | null> {
    return asInstallation(this.#tokens, githubInstallationId, (headers) =>
      fetchRepository(this.#octokit, headers, githubRepoId),
    );
  }

  getOrgMembership(githubInstallationId: GithubId, org: string, login: string): Promise<GitHubOrgMembership | null> {
    // The installation is checked first, so a refused installation is refused whatever the names are.
    return asInstallation(this.#tokens, githubInstallationId, (headers) =>
      NAME.test(org) && NAME.test(login) ? fetchMembership(this.#octokit, headers, org, login) : Promise.resolve(null),
    );
  }
}
