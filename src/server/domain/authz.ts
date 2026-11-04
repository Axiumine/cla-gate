// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// What a person may do in one installation (E11-S01). Pure: the caller resolves the three role facts (E11-S02, E11-S03)
// and this module only turns the requirement of the call and those facts into one of three answers. Nothing is read from
// GitHub, the database or the clock here, so the whole table is testable with no setup.

/** What a person is in an installation, by what GitHub says: an admin of the organisation, or an admin of one repository of it. */
export type Role = 'org_admin' | 'repo_admin';

/**
 * The role a call needs in the installation (the role matrix of the security notes): `org_admin` for the actions on a
 * resource of the installation itself, `repo_admin` for the actions on a resource of one repository (an org admin passes
 * those too). Signing and viewing one's own signatures need no role and no requirement: they are `authenticated` routes.
 * `any_role` (E14-S01) is for the one call that names the installation and no repository and that every person who has a
 * role in it may make: the list of its repositories, in which each person sees what their own role reaches.
 */
export type Requirement = Role | 'any_role';

/** What GitHub says about the viewer in this installation, by numeric id. */
export interface RoleFacts {
  /** The viewer is an active admin of the org (or the owner of the user account) the installation belongs to. */
  readonly orgAdmin: boolean;
  /** The viewer has the `admin` permission on the repository the call is about; false when the call names none. */
  readonly repoAdmin: boolean;
  /**
   * The viewer is an org admin, or an admin of at least one repository of the installation that carries a repo-scoped CLA
   * document (the discovery rule of E11-S03). Without such a role the viewer never learns the installation exists.
   */
  readonly hasRoleInInstallation: boolean;
}

/**
 * `allow`: the call proceeds. `forbidden`: the viewer has a role here but too low for this call (403). `not_found`: the
 * viewer has no role here, so the answer is the one for a tenant that does not exist (404); the two are never told apart.
 */
export type Decision = 'allow' | 'forbidden' | 'not_found';

/** `org_admin`: only an org admin passes; a repository admin or anyone with another role here is told it is forbidden. */
function forOrgAdmin(facts: RoleFacts): Decision {
  if (facts.orgAdmin) {
    return 'allow';
  }
  return facts.repoAdmin || facts.hasRoleInInstallation ? 'forbidden' : 'not_found';
}

/** `repo_admin`: an org admin or an admin of the repository passes; anyone else with a role here is forbidden. */
function forRepoAdmin(facts: RoleFacts): Decision {
  if (facts.orgAdmin || facts.repoAdmin) {
    return 'allow';
  }
  return facts.hasRoleInInstallation ? 'forbidden' : 'not_found';
}

/** `any_role`: an org admin, or a viewer the discovery found to be an admin of a repository here; anyone else is as good as unknown. */
function forAnyRole(facts: RoleFacts): Decision {
  return facts.orgAdmin || facts.repoAdmin || facts.hasRoleInInstallation ? 'allow' : 'not_found';
}

/**
 * The decision table. Anything that is not a known requirement is `not_found`: deny by default, and the answer that
 * reveals nothing.
 */
export function decide(requirement: Requirement, facts: RoleFacts): Decision {
  switch (requirement) {
    case 'org_admin':
      return forOrgAdmin(facts);
    case 'repo_admin':
      return forRepoAdmin(facts);
    case 'any_role':
      return forAnyRole(facts);
    default:
      return 'not_found';
  }
}
