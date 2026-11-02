// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import { parseGithubId } from '../../shared/github-id.ts';
import type { InstallationRow } from './installation-state.ts';
import type { RoleViewer } from './org-admin.ts';
import type { GitHubClient } from './ports/github.ts';
import { GitHubForbiddenError } from './ports/github-errors.ts';
import type { ProbeBudget } from './probe-budget.ts';
import type { RepositoryRow } from './repository-rows.ts';
import { withRoleDeadline } from './role-deadline.ts';

// The role fact "repository admin" (E11-S03): whether the person in the session has the `admin` permission on one
// repository, as GitHub says it by numeric id. Like the org admin fact of E11-S02 it is only a lookup: the cache in front
// of it is E11-S04's and the decision that uses it is the pure `decide` of src/server/domain/authz.ts.
//
// The owner and the name of the repository are `repositories.full_name`, a display snapshot that E05 keeps fresh, and the
// login of the viewer is `users.login` as the last login wrote it: both are only the handle of the lookup. A repository
// that was renamed or transferred since the last sync, or a login that was renamed since the last login, answers 404 and
// so fails closed until the next sync or login refreshes the name. Nothing is ever keyed on a name. One gap remains: GitHub
// may give a repository's old name to a new repository before that sync, and the call is then answered about the new one
// (the answer names no repository id to check). Addressing the repository by its id fixes it, once that call is checked
// against the real App; the open questions of docs/decisions.md say so.

/** The columns of a stored installation the lookup reads. */
export type RepoAdminInstallation = Pick<InstallationRow, 'github_installation_id'>;

/** The columns of a stored repository the lookup reads. */
export type RepoAdminRepository = Pick<RepositoryRow, 'full_name' | 'removed_at'>;

/** Whether `viewer` has the `admin` permission on `repository`. `budget` is spent right before GitHub is asked, never otherwise. */
export type RepoAdminLookup = (
  installation: RepoAdminInstallation,
  repository: RepoAdminRepository,
  viewer: RoleViewer,
  budget?: ProbeBudget,
) => Promise<boolean>;

/** The part of a logger the lookup uses. A request's logger is one. */
interface RoleLog {
  warn(fields: object, message: string): void;
}

export interface RepoAdminDeps {
  /** The only door to GitHub (E05-S04). */
  readonly github: Pick<GitHubClient, 'getRepositoryPermission'>;
  readonly log: RoleLog;
}

/** `owner/name` as two parts, or null for anything else: a name that is not exactly one slash between two names holds no repository. */
function splitFullName(fullName: string): { owner: string; repo: string } | null {
  const parts = fullName.split('/');
  const [owner, repo] = parts;
  return parts.length === 2 && owner !== undefined && owner !== '' && repo !== undefined && repo !== ''
    ? { owner, repo }
    : null;
}

/**
 * The lookup over `GET /repos/{owner}/{repo}/collaborators/{username}/permission` with the installation's own token.
 *
 * The viewer is an admin only when GitHub answers 200, the `permission` is `admin` and `user.id` is the viewer's numeric id
 * (a login that was recycled by someone else answers with another id and is refused). `maintain`, `write`, `triage`,
 * `read` and `none` are not admin, and `role_name` is never read, because a custom role maps onto the base `permission`.
 * A 404 (a repository that was renamed or transferred since the last sync, a person GitHub has not got) is a denial. A
 * repository that is removed is never probed, and neither is a name that cannot be an `owner/name`. A 403 that is a
 * missing permission is logged as `repository_permission_missing` with the numeric installation id and is not an admin,
 * because the lookup fails closed. Anything else that goes wrong is thrown for the HTTP edge to map (E11-S04), as for the
 * org admin: a rate limit (`GitHubRateLimitedError`), an outage or no answer within 5 s (`GitHubUnavailableError`), an
 * installation the instance does not serve (`InstallationNotAdmittedError`, thrown before any request; E11-S07 maps it).
 *
 * An org admin satisfies any repository requirement, so a caller that already knows the viewer is one does not call this
 * (see {@link repoAdminFact}).
 */
export function createRepoAdminLookup({ github, log }: RepoAdminDeps): RepoAdminLookup {
  return async (installation, repository, viewer, budget) => {
    const target = repository.removed_at === null ? splitFullName(repository.full_name) : null;
    if (target === null) {
      return false;
    }
    const githubInstallationId = parseGithubId(installation.github_installation_id);
    budget?.spend();
    try {
      const answer = await withRoleDeadline(
        github.getRepositoryPermission(githubInstallationId, target.owner, target.repo, viewer.login),
      );
      return answer !== null && answer.permission === 'admin' && answer.userId === viewer.githubId;
    } catch (error) {
      if (error instanceof GitHubForbiddenError) {
        log.warn({ githubInstallationId }, 'repository_permission_missing');
        return false;
      }
      throw error;
    }
  };
}

/**
 * The `repoAdmin` fact of a call that names a repository, given the `orgAdmin` fact the caller has already resolved: an org
 * admin satisfies any repository requirement, so for one `lookup` is not called and GitHub is not asked. For anyone else it
 * is the answer of `lookup`.
 */
export async function repoAdminFact(orgAdmin: boolean, lookup: () => Promise<boolean>): Promise<boolean> {
  return orgAdmin || (await lookup());
}
