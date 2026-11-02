// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parseGithubId } from '../../../shared/github-id.ts';
import type { OrgAdminInstallation, RoleViewer } from '../org-admin.ts';

// The people and installations the role lookups of E11 are tested with: made-up ids, as the stored rows hold them.

/** The signed-in person of the role tests: numeric id 501, who logged in as `alice`. */
export const VIEWER_ID = parseGithubId(501);

export const VIEWER: RoleViewer = { githubId: VIEWER_ID, login: 'alice' };

/** An installation of an organisation, as its stored row reads: the account id is the installation id plus 5000. */
export function orgInstallation(
  githubInstallationId: number,
  accountLogin: string,
  overrides: Partial<OrgAdminInstallation> = {},
): OrgAdminInstallation {
  return {
    github_installation_id: githubInstallationId,
    account_id: githubInstallationId + 5000,
    account_login: accountLogin,
    account_type: 'Organization',
    ...overrides,
  };
}

/** An installation of a user account whose owner has the numeric id `accountId`. */
export function userInstallation(githubInstallationId: number, accountId: number): OrgAdminInstallation {
  return orgInstallation(githubInstallationId, 'alice', { account_id: accountId, account_type: 'User' });
}
