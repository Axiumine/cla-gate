// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import type { GitHubOrgMembership, GitHubRepositoryPermission } from '../ports/github.ts';
import type { RoleGitHub } from '../tenant-authorizer.ts';

// The role port of the cross-tenant tests (E11-S06): what GitHub says about who is an admin of what, written as a table
// of numeric ids and answered the way the client port answers. Adapter-level tests use MSW instead; the tests of the
// tenant guard (E11-S05) script the in-memory `FakeGitHub` call by call.

/** One answer of `GET /orgs/{org}/memberships/{username}`: the person with this login is `userId`, and holds `role` in the organisation. */
interface OrgRoleRow {
  /** The GitHub installation id whose token asks: the table is tenant-keyed like GitHub's answers are. */
  readonly installation: GithubId;
  readonly login: string;
  readonly userId: GithubId;
  readonly role: GitHubOrgMembership['role'];
}

/** One answer of `GET /repos/{owner}/{repo}/collaborators/{username}/permission`. */
interface RepoRoleRow {
  readonly installation: GithubId;
  /** `owner/name`. */
  readonly fullName: string;
  readonly login: string;
  readonly userId: GithubId;
  readonly permission: GitHubRepositoryPermission['permission'];
}

export interface RoleTable {
  readonly orgs: readonly OrgRoleRow[];
  readonly repositories: readonly RepoRoleRow[];
}

/**
 * The role port answered from a table. A row that is not in the table is the `404` of GitHub: `null`. Every call is
 * recorded as `method installation target login`, so a test can show that a denial asked nobody anything it should not.
 */
export class StubRoleLookup implements RoleGitHub {
  readonly calls: string[] = [];
  #table: RoleTable;

  constructor(table: RoleTable = { orgs: [], repositories: [] }) {
    this.#table = table;
  }

  /** Replaces the table: the app is built first and the rows it describes are stored after. */
  load(table: RoleTable): void {
    this.#table = table;
  }

  getOrgMembership(githubInstallationId: GithubId, org: string, login: string): Promise<GitHubOrgMembership | null> {
    this.calls.push(`getOrgMembership ${githubInstallationId} ${org} ${login}`);
    const row = this.#table.orgs.find((entry) => entry.installation === githubInstallationId && entry.login === login);
    return Promise.resolve(row === undefined ? null : { state: 'active', role: row.role, userId: row.userId });
  }

  getRepositoryPermission(
    githubInstallationId: GithubId,
    owner: string,
    repo: string,
    login: string,
  ): Promise<GitHubRepositoryPermission | null> {
    this.calls.push(`getRepositoryPermission ${githubInstallationId} ${owner}/${repo} ${login}`);
    const row = this.#table.repositories.find(
      (entry) =>
        entry.installation === githubInstallationId && entry.fullName === `${owner}/${repo}` && entry.login === login,
    );
    return Promise.resolve(row === undefined ? null : { permission: row.permission, userId: row.userId });
  }
}
