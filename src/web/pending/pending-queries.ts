// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { SuccessOf } from '../../shared/contract.ts';
import type { PendingReasonCode } from '../../shared/pending-prs.ts';
import { listOverridesRoute, pendingPrsRoute } from '../../shared/pending-routes.ts';
import type { ApiClient } from '../api/index.ts';
import { installationKey } from '../installations/installation-queries.ts';

// The queries of the pending screen (E18-S08). Every key starts with `['installation', installationId]` (E18-S04), so the pending list and
// the overrides of one tenant are kept and dropped as a unit and never found under another tenant's key, whatever repository id the
// address carries.

/** One page of the pending list, as the endpoint sends it. */
export type PendingPrsPage = SuccessOf<typeof pendingPrsRoute>;

/** One pending pull request of a page. */
export type PendingPr = PendingPrsPage['items'][number];

/** One reason a pull request is pending. */
export type PendingReason = PendingPr['reasons'][number];

/** One page of the overrides of a repository, as the endpoint sends it. */
type OverridePage = SuccessOf<typeof listOverridesRoute>;

/** One override of a page. */
export type CommitOverride = OverridePage['items'][number];

/**
 * How many rows a page holds: the endpoints take 1 to 100 and this screen asks for 50, which is also their default.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const PENDING_PAGE_SIZE = 50;

/** The start of the key of every query about the pending pull requests of one installation: what a recorded override makes out of date. */
export function pendingKey(installationId: number) {
  return [...installationKey(installationId), 'pending'] as const;
}

/** The start of the key of every query about the overrides of one installation's repositories: what a record or a removal makes out of date. */
export function overridesKey(installationId: number) {
  return [...installationKey(installationId), 'overrides'] as const;
}

/** What a page of the pending list is asked for: the filters of the address and the cursor of the page. */
export interface PendingRequest {
  readonly repository: number | undefined;
  readonly reason: PendingReasonCode | undefined;
  readonly cursor: string | undefined;
}

/**
 * `GET /api/installations/:installationId/pending-prs?limit=50&repositoryId=&reason=&cursor=` (E15-S07). The installation is the one in
 * the path, which the server filters every row by. A page is kept under the filters and its cursor; the page on screen stays until the
 * next one of the same search is there (the screen is remounted for another installation or other filters, so it never shows the rows
 * of another one). The answer is asked for on every visit and again when the window gets focus, so a signature, an override or an
 * allowlist change made elsewhere shows up as the next evaluation lands.
 */
export function pendingQueryOptions(client: ApiClient, installationId: number, request: PendingRequest) {
  const { repository, reason, cursor } = request;
  return queryOptions({
    queryKey: [...pendingKey(installationId), repository ?? null, reason ?? null, cursor ?? null] as const,
    queryFn: ({ signal }) =>
      client.call(
        pendingPrsRoute,
        { params: { installationId }, query: { limit: PENDING_PAGE_SIZE, repositoryId: repository, reason, cursor } },
        { signal },
      ),
    staleTime: 0,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });
}

/**
 * `GET /api/repositories/:repositoryId/commit-overrides?limit=50&cursor=` (E15-S06). The key names the installation of the address and
 * the repository, so a repository id is never found under another tenant's key; the server filters by the tenant that owns the
 * repository and answers `404` for one that is not the person's.
 */
export function overridesQueryOptions(
  client: ApiClient,
  installationId: number,
  repositoryId: number,
  cursor: string | undefined,
) {
  return queryOptions({
    queryKey: [...overridesKey(installationId), repositoryId, cursor ?? null] as const,
    queryFn: ({ signal }) =>
      client.call(
        listOverridesRoute,
        { params: { repositoryId }, query: { limit: PENDING_PAGE_SIZE, cursor } },
        { signal },
      ),
    staleTime: 0,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });
}
