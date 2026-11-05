// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { PendingReasonCode } from '../../shared/pending-prs.ts';
import type { Database } from '../adapters/db/schema.ts';
import { administeredRepositories } from './administered-repositories.ts';
import type { RoleViewer } from './org-admin.ts';
import { repositoriesWithPending } from './pending-prs-current.ts';
import { servedRepositories } from './pending-prs-repositories.ts';
import { PROBE_BUDGETS } from './probe-budget.ts';
import type { ListedFor } from './repository-list.ts';
import type { CachedRepoAdminLookup } from './role-lookups.ts';

// Which repositories the pending pull requests of a request may come from (E15-S07). An org admin reaches every served repository of the
// installation (enabled, not removed, of an installation that is admitted, not suspended and not uninstalled). A viewer who is only a
// repository admin reaches the served repositories whose enforced CLA document is scoped to the repository itself and that the cached
// lookup of E11-S04 confirms they administer; the lookup is asked only of repositories that have a pending pull request, for at most 50
// of them a request, in the order of their id.

export interface PendingScopeDeps {
  readonly db: Kysely<Database>;
  /** The permission lookup with the role cache in front of it (E11-S04): a repository asked about a moment ago costs nothing. */
  readonly lookup: CachedRepoAdminLookup;
}

/** The repositories a request may read, and whether a repository admin's reach was cut at the 50 that were asked about. */
export interface ReadableRepositories {
  /** `repositories.id`, in order; empty when the viewer reaches none. */
  readonly repositoryIds: readonly number[];
  readonly truncated: boolean;
}

/** What narrows the repositories a request is about: one repository, and the reason a pending pull request has to list. */
export interface PendingNarrowing {
  /** `repositories.id` of the one repository to look at; `null` for all the viewer reaches. */
  readonly repositoryId: number | null;
  readonly reason: PendingReasonCode | null;
}

/**
 * The repositories whose pending pull requests the viewer may read. A failing lookup (GitHub down, rate limited, the person over their
 * budget) fails the call, and is never "you administer none".
 * @throws what the role lookups throw for a repository admin: `GitHubUnavailableError`, `GitHubRateLimitedError`,
 * `RoleLookupThrottledError`, `InstallationNotAdmittedError`.
 */
export async function readableRepositories(
  deps: PendingScopeDeps,
  listedFor: ListedFor,
  viewer: RoleViewer,
  narrowing: PendingNarrowing,
): Promise<ReadableRepositories> {
  const { db, lookup } = deps;
  const { repositoryId, reason } = narrowing;
  if (listedFor.role === 'org_admin') {
    const served = await servedRepositories(db, listedFor, { repositoryId, ownDocumentOnly: false });
    return { repositoryIds: served.map(({ id }) => id), truncated: false };
  }
  const asking = PROBE_BUDGETS.repositoryList;
  const candidates = await servedRepositories(db, listedFor, { repositoryId, ownDocumentOnly: true });
  const withPending = await repositoriesWithPending(
    db,
    listedFor,
    candidates.map(({ id }) => id),
    { reason, limit: asking + 1 },
  );
  const asked = new Set(withPending.slice(0, asking));
  const confirmed = await administeredRepositories(
    lookup,
    listedFor,
    viewer,
    candidates.filter(({ id }) => asked.has(id)),
  );
  return { repositoryIds: confirmed.map(({ id }) => id), truncated: withPending.length > asking };
}
