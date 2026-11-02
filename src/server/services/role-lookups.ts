// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parseGithubId } from '../../shared/github-id.ts';
import type { InstallationRowId } from '../adapters/db/installation-row-id.ts';
import type { OrgAdminInstallation, RoleViewer } from './org-admin.ts';
import type { ProbeBudget } from './probe-budget.ts';
import type { RepoAdminInstallation, RepoAdminLookup, RepoAdminRepository } from './repo-admin.ts';
import type { LookupContext, RoleCache } from './role-cache.ts';
import { ORG_SCOPE, repoScope } from './role-key.ts';
import type { ViewerLookupBudget } from './role-lookup-budget.ts';

// The role lookups of E11-S02 and E11-S03 with the role cache in front of them (E11-S04). A request that needs a role
// fact asks one of these, never the bare lookup: a hit costs GitHub nothing and spends neither a probe of the request's
// budget nor one of the person's 30 uncached lookups a minute; a miss spends both and asks GitHub once however many
// requests are waiting for the same answer.

/** What a guarded route does: `read` may use the cached role, `write` always asks GitHub again (E11-S01, E11-S05). */
export type RoleLookupMode = 'read' | 'write';

/** The installation as the cache needs it: `id` is `installations.id`, the tenant key the answers are kept under. */
interface TenantKey {
  readonly id: InstallationRowId;
}

/** The repository as the cache needs it: the numeric GitHub id the answer is kept under, never the name. */
interface RepositoryKey {
  readonly github_repo_id: number;
}

/**
 * Whether the viewer is an admin of the account the installation belongs to (E11-S02), through the cache. The cache tells
 * the lookup behind it whether it is still the current one (`context`), which the ledger of E11-S07 asks before it writes.
 */
export type CachedOrgAdminLookup = (
  installation: OrgAdminInstallation & TenantKey,
  viewer: RoleViewer,
  context?: LookupContext,
) => Promise<boolean>;

/**
 * Whether the viewer has the `admin` permission on the repository (E11-S03), through the cache. Same arguments as
 * {@link RepoAdminLookup} plus the keys of the cache, so the repository admin discovery takes either.
 */
export type CachedRepoAdminLookup = (
  installation: RepoAdminInstallation & TenantKey,
  repository: RepoAdminRepository & RepositoryKey,
  viewer: RoleViewer,
  budget?: ProbeBudget,
) => Promise<boolean>;

export interface RoleLookups {
  readonly orgAdmin: CachedOrgAdminLookup;
  readonly repoAdmin: CachedRepoAdminLookup;
}

export interface RoleLookupDeps {
  readonly cache: RoleCache;
  /** The 30 uncached lookups a minute of each person. */
  readonly budget: ViewerLookupBudget;
  /** The bare lookup (E11-S02), or one that keeps the ledger of admins by what it finds (E11-S07): it runs for a live answer only. */
  readonly orgAdmin: CachedOrgAdminLookup;
  readonly repoAdmin: RepoAdminLookup;
}

/** Counts the lookup against the person, then makes it. It only runs for a miss: the cache calls it, nobody else. */
function costing(budget: ViewerLookupBudget, viewer: RoleViewer, lookup: () => Promise<boolean>): Promise<boolean> {
  budget.spend(viewer.githubId);
  return lookup();
}

function orgAdminLookup(deps: RoleLookupDeps, fresh: boolean): CachedOrgAdminLookup {
  return (installation, viewer) => {
    // Only an organisation costs a GitHub call: a user account is decided by comparing ids, and any other type is never
    // served. Such an answer is as cheap as a cache hit and cannot go stale, so it is neither kept nor counted.
    if (installation.account_type !== 'Organization') {
      return deps.orgAdmin(installation, viewer);
    }
    const key = { installationId: installation.id, viewerGithubId: viewer.githubId, scope: ORG_SCOPE };
    return deps.cache.resolve(
      key,
      (context) => costing(deps.budget, viewer, () => deps.orgAdmin(installation, viewer, context)),
      { fresh },
    );
  };
}

function repoAdminLookup(deps: RoleLookupDeps, fresh: boolean): CachedRepoAdminLookup {
  return (installation, repository, viewer, budget) => {
    const key = {
      installationId: installation.id,
      viewerGithubId: viewer.githubId,
      scope: repoScope(parseGithubId(repository.github_repo_id)),
    };
    return deps.cache.resolve(
      key,
      () => costing(deps.budget, viewer, () => deps.repoAdmin(installation, repository, viewer, budget)),
      { fresh },
    );
  };
}

/**
 * The cached lookups by what the route does. `read` serves a cached answer up to 60 s old; `write` is `fresh: true`: the
 * cached answer is ignored and replaced, so a write sees a demotion at once while a read may still see the old role until
 * its answer expires. Both share one cache, so a fresh answer is what the next read gets.
 *
 * The failures of a lookup (`GitHubUnavailableError`, `GitHubRateLimitedError`, `InstallationNotAdmittedError`, and
 * `RoleLookupThrottledError` from the person's budget) are thrown as they are: they are never an answer, never kept, and
 * the HTTP edge maps them (src/server/adapters/http/upstream-failure.ts).
 */
export function createRoleLookups(deps: RoleLookupDeps): Record<RoleLookupMode, RoleLookups> {
  return {
    read: { orgAdmin: orgAdminLookup(deps, false), repoAdmin: repoAdminLookup(deps, false) },
    write: { orgAdmin: orgAdminLookup(deps, true), repoAdmin: repoAdminLookup(deps, true) },
  };
}
