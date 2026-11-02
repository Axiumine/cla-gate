// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';

// The only door to GitHub for the services (E05-S04). The domain and src/shared never import it. The Octokit adapter
// (src/server/adapters/github) implements it for production and `FakeGitHub` (src/server/services/test-support.ts) in
// memory; both run the same contract suite.
//
// Extension rule: a later epic adds a method here together with its own zod schema in the adapter, its row in the
// fake and its case in the contract suite. No method returns a raw Octokit response: a method returns the fields the
// platform uses, in the types below.
//
// What a method throws is in `./github-errors.ts`: 401 is GitHubAuthError, 404 GitHubNotFoundError (unless the method
// resolves null for it), another 403 GitHubForbiddenError, a 5xx or a network failure GitHubUnavailableError, a rate
// limit that is too long to wait out (or that came back after two waits) GitHubRateLimitedError, an answer that is not
// what the schema says GitHubResponseError, and an installation the instance does not serve
// InstallationNotAdmittedError (installation-level methods only, before any request).

/** The account types an App can be installed on or owned by. */
type GitHubAccountType = 'User' | 'Organization';

/** The App the JWT belongs to (`GET /app`). */
export interface GitHubAppInfo {
  readonly id: GithubId;
  readonly slug: string;
  /** The account that owns the App. */
  readonly owner: { readonly id: GithubId; readonly type: GitHubAccountType };
  /** Permission name to level, for example `checks` to `write`. */
  readonly permissions: Readonly<Record<string, string>>;
}

/** One installation of the App. The login is a display snapshot; the numeric ids are the identity. */
export interface GitHubInstallation {
  /** The installation id: the tenant key. */
  readonly id: GithubId;
  readonly account: {
    readonly id: GithubId;
    readonly login: string;
    readonly type: GitHubAccountType;
  };
  /** When GitHub suspended the installation; null while it is active. */
  readonly suspendedAt: Date | null;
  readonly permissions: Readonly<Record<string, string>>;
}

/** A repository the installation can reach. The name is a display snapshot; the numeric id is the identity. */
export interface GitHubRepository {
  readonly id: GithubId;
  /** `owner/name`. */
  readonly fullName: string;
}

/** A person's membership of an organisation (`GET /orgs/{org}/memberships/{username}`). */
export interface GitHubOrgMembership {
  /** `pending` is an invitation that was not accepted yet. */
  readonly state: 'active' | 'pending';
  readonly role: 'admin' | 'member' | 'billing_manager';
  /** The member's numeric GitHub id. */
  readonly userId: GithubId;
}

export interface GitHubClient {
  /** `GET /app`, signed as the App. */
  getApp(): Promise<GitHubAppInfo>;

  /** `GET /app/installations/{id}`, signed as the App. Resolves null when the installation does not exist (404). */
  getInstallation(githubInstallationId: GithubId): Promise<GitHubInstallation | null>;

  /**
   * `GET /app/installations?per_page=100`, signed as the App: every installation of the App, all pages.
   * @throws GitHubResponseError `pagination_limit` past 100 pages: a truncated list is never returned.
   */
  listInstallations(): Promise<GitHubInstallation[]>;

  /**
   * `GET /installation/repositories?per_page=100` with the installation's token: every repository it can reach, all
   * pages.
   * @throws GitHubResponseError `pagination_limit` past 100 pages: a truncated list would mark repositories removed.
   */
  listInstallationRepositories(githubInstallationId: GithubId): Promise<GitHubRepository[]>;

  /**
   * `GET /repositories/{id}` with the installation's token. Resolves null when the repository does not exist or the
   * installation cannot see it (404 or 403).
   */
  getRepositoryById(githubInstallationId: GithubId, githubRepoId: GithubId): Promise<GitHubRepository | null>;

  /**
   * `GET /orgs/{org}/memberships/{username}` with the installation's token (Members: read). Resolves null when there
   * is no such membership (404) and for a name GitHub cannot hold (no request is sent for it; the installation is
   * checked first all the same). This is the one membership call:
   * the exemption lookup (E07-S10) and the admin role (E11-S02) both use it.
   */
  getOrgMembership(githubInstallationId: GithubId, org: string, login: string): Promise<GitHubOrgMembership | null>;
}
