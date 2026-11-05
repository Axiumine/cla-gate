// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { PendingReasonCode } from '../../shared/pending-prs.ts';
import { pendingReasons } from '../domain/pending-reasons.ts';
import type { RoleViewer } from './org-admin.ts';
import { accountsOf, type PendingPr, toPendingPr } from './pending-prs-item.ts';
import type { PendingPosition } from './pending-prs-position.ts';
import { pendingRows } from './pending-prs-queries.ts';
import { isRepositoryOfTenant } from './pending-prs-repositories.ts';
import { type PendingScopeDeps, readableRepositories } from './pending-prs-scope.ts';
import type { ListedFor } from './repository-list.ts';
import { loginsOf } from './user-logins.ts';

// The pending pull requests a maintainer sees (E15-S07): the open pull requests whose latest evaluation is a failure. The role decides
// which repositories it may read (pending-prs-scope.ts), one statement reads the page (pending-prs-queries.ts), the pure function
// of domain/pending-reasons.ts turns each row's stored details into reasons, and the `users` snapshot names the accounts. Nothing here
// writes and nothing asks GitHub.

/** What a request asks for: the filters, the page size and the row the page starts at. */
export interface PendingRequest {
  /** `repositories.id`; `null` for every repository the viewer reaches. */
  readonly repositoryId: number | null;
  readonly reason: PendingReasonCode | null;
  readonly limit: number;
  readonly from: PendingPosition | null;
}

/** A page of the list: the pull requests, where the next page starts (`null` on the last), and whether a repository admin's reach was cut. */
export interface PendingPage {
  readonly items: readonly PendingPr[];
  readonly next: PendingPosition | null;
  readonly truncated: boolean;
}

/**
 * One page of the pending pull requests of the tenant `listedFor` that `viewer` may read, the most recently written first. `null` when
 * the request names a repository that is not in the tenant. A pull request whose stored details name no recognised reason is listed
 * with the single reason `other`, never hidden. Every statement filters by the installation id.
 * @throws what the role lookups throw for a repository admin: `GitHubUnavailableError`, `GitHubRateLimitedError`,
 * `RoleLookupThrottledError`, `InstallationNotAdmittedError`.
 */
export async function listPendingPrs(
  deps: PendingScopeDeps,
  listedFor: ListedFor,
  viewer: RoleViewer,
  request: PendingRequest,
): Promise<PendingPage | null> {
  const { repositoryId, reason, limit, from } = request;
  if (repositoryId !== null && !(await isRepositoryOfTenant(deps.db, listedFor, repositoryId))) {
    return null;
  }
  const { repositoryIds, truncated } = await readableRepositories(deps, listedFor, viewer, { repositoryId, reason });
  if (repositoryIds.length === 0) {
    return { items: [], next: null, truncated };
  }
  const rows = await pendingRows(deps.db, listedFor, { repositoryIds, reason, limit, from });
  const found = rows.slice(0, limit).map((row) => ({ row, reasons: pendingReasons(row.details) }));
  const logins = await loginsOf(deps.db, found.flatMap(accountsOf));
  const [following] = rows.slice(limit);
  return {
    items: found.map((one) => toPendingPr(one, logins)),
    next: following === undefined ? null : { updatedAt: following.updatedAtMicros, id: following.id },
    truncated,
  };
}
