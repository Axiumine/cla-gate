// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Role } from '../domain/authz.ts';
import { tenantState } from '../domain/tenant-state.ts';
import type { InstallationRow } from './installation-state.ts';
import { mapConcurrently } from './map-concurrently.ts';
import type { RoleViewer } from './org-admin.ts';
import {
  InstallationGoneError,
  InstallationNotAdmittedError,
  InstallationSuspendedError,
} from './ports/github-errors.ts';
import type { ProbeBudget } from './probe-budget.ts';
import { type TenantAuthorizationDeps, tenantFacts } from './tenant-authorization.ts';

// The role a person holds in each installation of the instance (E14-S01). It is the role-in-installation rule of E11-S01,
// asked of every installation the instance serves: an org admin by the cached lookup (or, for a suspended tenant, by the
// stored row and the ledger of E11-S07), anyone else by the discovery of an admin permission on a repository that carries a
// repo-scoped CLA document (E11-S03). The facts are the ones the tenant guard decides with, so a person who is listed is
// a person the guard lets in.

/** How many installations are asked about whether the person is an org admin at once. */
const ORG_LOOKUP_CONCURRENCY = 5;

/** An installation the person holds a role in, and which. */
interface HeldRole {
  readonly installation: InstallationRow;
  readonly role: Role;
}

/** The roles found, and whether the budget ended the search of repository admins before it asked about every repository. */
export interface FoundRoles {
  readonly held: readonly HeldRole[];
  readonly truncated: boolean;
}

/** What is known of the person in one installation once the org admin fact is read. */
interface OrgFact {
  readonly installation: InstallationRow;
  readonly active: boolean;
  /** The person is an org admin; null when GitHub stopped serving the installation under the lookup, so nothing is known of them there. */
  readonly orgAdmin: boolean | null;
}

/**
 * An installation GitHub or the instance stopped serving between the read of its row and the lookup: the gate refused it, or
 * GitHub refused its token before a webhook brought the row up to date. The person has no role there that anyone can verify.
 */
function isNoLongerServed(error: unknown): boolean {
  return (
    error instanceof InstallationNotAdmittedError ||
    error instanceof InstallationSuspendedError ||
    error instanceof InstallationGoneError
  );
}

/** The org admin fact of one installation: the guard's facts for a call that names no repository. */
async function orgFactOf(
  deps: TenantAuthorizationDeps,
  viewer: RoleViewer,
  installation: InstallationRow,
): Promise<OrgFact> {
  const active =
    tenantState({
      admissionStatus: installation.admission_status,
      deletedAt: installation.deleted_at,
      suspendedAt: installation.suspended_at,
    }) === 'active';
  try {
    const facts = await tenantFacts(deps, {
      mode: 'read',
      requirement: 'any_role',
      installation,
      repository: null,
      viewer,
      active,
    });
    return { installation, active, orgAdmin: facts.orgAdmin };
  } catch (error) {
    if (isNoLongerServed(error)) {
      return { installation, active, orgAdmin: null };
    }
    throw error;
  }
}

/** Whether the viewer administers a repository of the installation, with the shared `budget`; false for one that is no longer served. */
async function administersARepository(
  deps: TenantAuthorizationDeps,
  viewer: RoleViewer,
  installation: InstallationRow,
  budget: ProbeBudget,
): Promise<{ readonly admin: boolean; readonly truncated: boolean }> {
  try {
    const found = await deps.discover(viewer, installation.id, budget);
    return { admin: found.role === 'repo_admin', truncated: found.truncated };
  } catch (error) {
    if (isNoLongerServed(error)) {
      return { admin: false, truncated: false };
    }
    throw error;
  }
}

/**
 * The installations of `installations` the viewer holds a role in, in their order, with the role. The org admin facts are
 * asked five at a time; the discovery of repository admins then runs installation by installation, in order, sharing
 * `budget`, so that the first installations are the ones searched when it runs out. Only an installation that is served
 * is searched: a suspended one is listed for its org admins and for nobody else, as the guard treats it. A failing lookup
 * (GitHub down or rate limited, the person over their budget) fails the whole search and is never "you administer none".
 * @throws what the lookups throw: `GitHubUnavailableError`, `GitHubRateLimitedError`, `RoleLookupThrottledError`.
 */
export async function findRoles(
  deps: TenantAuthorizationDeps,
  viewer: RoleViewer,
  installations: readonly InstallationRow[],
  budget: ProbeBudget,
): Promise<FoundRoles> {
  const facts = await mapConcurrently(installations, ORG_LOOKUP_CONCURRENCY, (installation) =>
    orgFactOf(deps, viewer, installation),
  );
  const held: HeldRole[] = [];
  let truncated = false;
  for (const { installation, active, orgAdmin } of facts) {
    if (orgAdmin === true) {
      held.push({ installation, role: 'org_admin' });
    } else if (orgAdmin === false && active) {
      const search = await administersARepository(deps, viewer, installation, budget);
      truncated ||= search.truncated;
      if (search.admin) {
        held.push({ installation, role: 'repo_admin' });
      }
    }
  }
  return { held, truncated };
}
