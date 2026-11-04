// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { InstallationRowId } from '../adapters/db/installation-row-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { Role } from '../domain/authz.ts';
import { listAdministrableInstallations } from './installation-queries.ts';
import { findRoles } from './installation-roles.ts';
import type { RoleViewer } from './org-admin.ts';
import { PROBE_BUDGETS, ProbeBudget } from './probe-budget.ts';
import { countRepositories } from './repository-count-queries.ts';
import type { TenantAuthorizationDeps } from './tenant-authorization.ts';

// The installations a signed-in person administers on this instance (E14-S01): every installation the admission policy
// admitted and the App is still installed on, narrowed to those where a role lookup says the person holds a role, with what
// they hold, whether the installation is suspended and how many repositories it has. Rows of an installation the person
// holds no role in are never read beyond its own row, and nothing about it is returned.

export interface InstallationListDeps {
  readonly db: Kysely<Database>;
  /** The lookups the tenant guard decides with: the roles listed are the roles it enforces. */
  readonly roles: TenantAuthorizationDeps;
}

/** One installation of the list (`installationSummarySchema`). */
export interface AdministeredInstallation {
  readonly id: InstallationRowId;
  readonly accountLogin: string;
  readonly accountType: 'Organization' | 'User' | 'Other';
  readonly role: Role;
  readonly suspended: boolean;
  readonly repositoryCount: number;
  readonly enabledCount: number;
  readonly truncated: boolean;
}

/**
 * The installations `viewer` administers, by account login and id. The search for repository admins spends at most 100
 * lookups of GitHub across all installations (`PROBE_BUDGETS.installationList`; an answer of the role cache is free); when
 * it ran into that limit, or the person used the lookups the list may make a minute, `truncated` is true on every row. The
 * counts are those of the repositories that are not removed.
 * @throws what the role lookups throw: `GitHubUnavailableError`, `GitHubRateLimitedError`.
 */
export async function listAdministeredInstallations(
  deps: InstallationListDeps,
  viewer: RoleViewer,
): Promise<AdministeredInstallation[]> {
  const installations = await listAdministrableInstallations(deps.db);
  const { held, truncated } = await findRoles(
    deps.roles,
    viewer,
    installations,
    new ProbeBudget(PROBE_BUDGETS.installationList),
  );
  const counted = await Promise.all(
    held.map(async ({ installation, role }) => ({
      installation,
      role,
      counts: await countRepositories(deps.db, { installationId: installation.id }),
    })),
  );
  return counted.map(({ installation, role, counts }) => ({
    id: installation.id,
    accountLogin: installation.account_login,
    accountType: installation.account_type,
    role,
    suspended: installation.suspended_at !== null,
    repositoryCount: counts.repositories,
    enabledCount: counts.enabled,
    truncated,
  }));
}
