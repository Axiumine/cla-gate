// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { InstallationRow } from './installation-state.ts';
import type { GitHubClient } from './ports/github.ts';
import { GitHubForbiddenError } from './ports/github-errors.ts';
import { withRoleDeadline } from './role-deadline.ts';

// The role fact "org admin" (E11-S02): whether the person in the session is an admin of the account an installation
// belongs to, as GitHub says it by numeric id. The decision table that uses the fact is the pure `decide` of
// src/server/domain/authz.ts; the cache that sits in front of this lookup is E11-S04's.
//
// The organisation is `installations.account_login` and the login of the viewer is `users.login` as the last login wrote
// them: both are display snapshots, and here they are only the handle of the lookup. A login or an organisation that was
// renamed since fails closed (GitHub answers 404 for the old name, so the viewer is not an admin) until the next login
// or installation sync refreshes the name. That is documented, not worked around: nothing is ever keyed on a name.

/** The columns of a stored installation the lookup reads. */
export type OrgAdminInstallation = Pick<
  InstallationRow,
  'github_installation_id' | 'account_id' | 'account_login' | 'account_type'
>;

/** The signed-in person as the session knows them: the numeric id is the identity, the login only the lookup handle. */
export interface RoleViewer {
  readonly githubId: GithubId;
  readonly login: string;
}

/** The part of a logger the lookup uses. A request's logger is one. */
interface RoleLog {
  warn(fields: object, message: string): void;
}

export interface OrgAdminDeps {
  /** The only door to GitHub (E05-S04). Its membership call is the one the exemption lookup (E07-S10) uses too. */
  readonly github: Pick<GitHubClient, 'getOrgMembership'>;
  readonly log: RoleLog;
}

/**
 * Whether `viewer` is an admin of the account `installation` belongs to.
 *
 * An installation of an organisation: `GET /orgs/{org}/memberships/{username}` with the installation's own token. The
 * viewer is an admin only when the answer is a membership that is `active`, whose `role` is `admin` and whose `user.id` is
 * the viewer's numeric id (a login that was recycled by someone else answers with another id and is refused); no
 * membership (404), a pending invitation and every other role are not. A 403 that is a missing permission (Members: read
 * not accepted yet) is logged as `members_permission_missing` with the numeric installation id and is not an admin,
 * because the lookup fails closed. Anything else that goes wrong is thrown for the HTTP edge to map (E11-S04): a rate
 * limit (`GitHubRateLimitedError`), an outage or no answer within 5 s (`GitHubUnavailableError`), an installation the
 * instance does not serve (`InstallationNotAdmittedError`, thrown before any request; E11-S07 maps it).
 *
 * An installation of a user account: the viewer is the owner, and so an admin, exactly when `account_id` is their numeric
 * id; no request is made. An account of another type is never served, so nobody is an admin of it.
 */
export function createOrgAdminLookup(
  deps: OrgAdminDeps,
): (installation: OrgAdminInstallation, viewer: RoleViewer) => Promise<boolean> {
  return async (installation, viewer) => {
    switch (installation.account_type) {
      case 'User':
        return installation.account_id === viewer.githubId;
      case 'Organization':
        return organisationAdmin(deps, installation, viewer);
      case 'Other':
        return false;
    }
  };
}

async function organisationAdmin(
  { github, log }: OrgAdminDeps,
  installation: OrgAdminInstallation,
  viewer: RoleViewer,
): Promise<boolean> {
  const githubInstallationId = parseGithubId(installation.github_installation_id);
  try {
    const membership = await withRoleDeadline(
      github.getOrgMembership(githubInstallationId, installation.account_login, viewer.login),
    );
    return (
      membership !== null &&
      membership.state === 'active' &&
      membership.role === 'admin' &&
      membership.userId === viewer.githubId
    );
  } catch (error) {
    if (error instanceof GitHubForbiddenError) {
      log.warn({ githubInstallationId }, 'members_permission_missing');
      return false;
    }
    throw error;
  }
}
