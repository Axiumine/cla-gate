// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { InstallationRowId } from '../adapters/db/installation-row-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { Role } from '../domain/authz.ts';
import { mapConcurrently } from './map-concurrently.ts';
import type { RoleViewer } from './org-admin.ts';
import { PROBE_BUDGETS } from './probe-budget.ts';
import { positionOf, type RepositoryEntry, type RepositoryPosition } from './repository-entry.ts';
import { type ListedRepository, present } from './repository-item.ts';
import { listRepositoryEntries, type RepositoryRead } from './repository-list-queries.ts';
import type { CachedRepoAdminLookup } from './role-lookups.ts';

// The page of the repositories of one installation that a person may see (E14-S01). An org admin sees every repository that is
// not removed. A repository admin sees only those the role lookups of E11-S03 confirm: they are found among the repositories
// that carry a repo-scoped CLA document, the only ones an admin of one repository can be discovered through, and each costs
// one lookup, so a page asks about at most 50 of them. Nothing here reads GitHub except through the cached lookup.

/** How many repositories are asked about at once. */
const LOOKUP_CONCURRENCY = 5;

export interface RepositoryListDeps {
  readonly db: Kysely<Database>;
  /** The permission lookup with the role cache in front of it (E11-S04): a repository asked about a moment ago costs nothing. */
  readonly lookup: CachedRepoAdminLookup;
}

/** What the page is for: the tenant and the role the guard let the viewer in with. */
export interface ListedFor {
  /** `installations.id`: every statement of the page names it. */
  readonly installationId: InstallationRowId;
  readonly role: Role;
}

/** The part of the request that narrows and cuts the list: the page size, where to start and the two filters. */
export type RepositoryListRequest = Pick<RepositoryRead, 'limit' | 'from' | 'q' | 'enabled'>;

/** A page: the repositories, and the position of the next page's first repository, or null on the last page. */
export interface RepositoryPage {
  readonly items: ListedRepository[];
  readonly next: RepositoryPosition | null;
}

/** The repositories one of the two reads of the page found, and where the next page starts. */
interface EntryPage {
  readonly entries: readonly RepositoryEntry[];
  readonly next: RepositoryPosition | null;
}

/** The page of an org admin: every repository, the first `request.limit` of them. One more is read to know where the next page starts. */
async function orgAdminPage(
  deps: RepositoryListDeps,
  installationId: InstallationRowId,
  request: RepositoryListRequest,
): Promise<EntryPage> {
  const read = { ...request, limit: request.limit + 1, withRepositoryDocument: false };
  const rows = await listRepositoryEntries(deps.db, { installationId }, read);
  return { entries: rows.slice(0, request.limit), next: positionOf(rows[request.limit]) };
}

/**
 * The page of a repository admin: the repositories that carry a repo-scoped document, `min(limit, 50)` of them from the
 * start of the page, each asked of the cached lookup, and the ones the viewer administers. The page may hold fewer than
 * `limit` repositories and still have a next page: the next one starts where this one stopped asking. A failing lookup
 * (GitHub down, rate limited, the person over their budget) fails the page, and is never "you administer none".
 */
async function repoAdminPage(
  deps: RepositoryListDeps,
  installationId: InstallationRowId,
  viewer: RoleViewer,
  request: RepositoryListRequest,
): Promise<EntryPage> {
  const asking = Math.min(request.limit, PROBE_BUDGETS.repositoryList);
  const read = { ...request, limit: asking + 1, withRepositoryDocument: true };
  const candidates = await listRepositoryEntries(deps.db, { installationId }, read);
  const asked = candidates.slice(0, asking);
  const verdicts = await mapConcurrently(asked, LOOKUP_CONCURRENCY, async (entry) => ({
    entry,
    administered: await deps.lookup(
      { id: installationId, github_installation_id: entry.githubInstallationId },
      { github_repo_id: entry.githubRepoId, full_name: entry.fullName, removed_at: null },
      viewer,
    ),
  }));
  return {
    entries: verdicts.filter(({ administered }) => administered).map(({ entry }) => entry),
    next: positionOf(candidates.at(asking)),
  };
}

/**
 * One page of the repositories of the tenant `listedFor` that `viewer` may see. An org admin sees them all; a repository
 * admin sees those confirmed by GitHub. Every statement filters by the installation id.
 * @throws what the role lookups throw for a repository admin: `GitHubUnavailableError`, `GitHubRateLimitedError`,
 * `RoleLookupThrottledError`, `InstallationNotAdmittedError`.
 */
export async function listRepositoryPage(
  deps: RepositoryListDeps,
  listedFor: ListedFor,
  viewer: RoleViewer,
  request: RepositoryListRequest,
): Promise<RepositoryPage> {
  const { installationId, role } = listedFor;
  const page =
    role === 'org_admin'
      ? await orgAdminPage(deps, installationId, request)
      : await repoAdminPage(deps, installationId, viewer, request);
  return { items: page.entries.map((entry) => present(entry, role)), next: page.next };
}
