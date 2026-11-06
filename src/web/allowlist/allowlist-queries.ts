// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { infiniteQueryOptions } from '@tanstack/react-query';
import { ALLOWLIST_PAGE_SIZE, type ListedEntryResponse } from '../../shared/allowlist.ts';
import { installationAllowlistRoute, repositoryAllowlistRoute } from '../../shared/allowlist-routes.ts';
import type { ApiClient } from '../api/index.ts';
import { installationKey } from '../installations/installation-queries.ts';

// The queries of the allowlist screen (E18-S06). Every key starts with `['installation', installationId]` (E18-S04), so the entries of one
// tenant are kept and dropped as a unit and never found under another tenant's key. No query uses `placeholderData`: while another scope or
// tenant is loading the screen shows loading and never the rows of the one before.

/** One entry of a list. */
export type Entry = ListedEntryResponse;

/** What a scope shows: its own entries, and the ones it inherits from the installation (always none for the installation itself). */
export interface AllowlistView {
  readonly own: readonly Entry[];
  readonly inherited: readonly Entry[];
}

/** One page of either list, in the shape the screen reads. */
interface AllowlistPage extends AllowlistView {
  readonly nextCursor: string | null;
}

/** The start of the key of every query about the allowlist of one installation: what an add or a removal makes out of date. */
export function allowlistKey(installationId: number) {
  return [...installationKey(installationId), 'allowlist'] as const;
}

/** The query of a page: the most entries a page holds, and the cursor of the page before when there is one. */
function pageQuery(cursor: string | undefined) {
  return { limit: String(ALLOWLIST_PAGE_SIZE.max), ...(cursor === undefined ? {} : { cursor }) };
}

/** What a page of the request is asked for: the tenant and scope of the screen, the cursor of the page, the signal that cancels it. */
interface PageRequest {
  readonly client: ApiClient;
  readonly installationId: number;
  readonly repositoryId: number | undefined;
  readonly cursor: string | undefined;
  readonly signal: AbortSignal;
}

/**
 * One page of the entries of the scope: the installation's own list (`entries`) or the repository's (`own` and `inherited`). The
 * repository is addressed by its own id and nothing else: the server filters by the tenant that repository belongs to.
 */
async function readPage({ client, installationId, repositoryId, cursor, signal }: PageRequest): Promise<AllowlistPage> {
  const query = pageQuery(cursor);
  if (repositoryId === undefined) {
    const page = await client.call(installationAllowlistRoute, { params: { installationId }, query }, { signal });
    return { own: page.entries, inherited: [], nextCursor: page.nextCursor };
  }
  const page = await client.call(repositoryAllowlistRoute, { params: { repositoryId }, query }, { signal });
  return { own: page.own, inherited: page.inherited, nextCursor: page.nextCursor };
}

/** The entries of the pages that have been loaded: every page in the order it came, its own entries before the inherited ones. */
function viewOf(data: { readonly pages: readonly AllowlistPage[] }): AllowlistView {
  return {
    own: data.pages.flatMap((page) => page.own),
    inherited: data.pages.flatMap((page) => page.inherited),
  };
}

/** The cursor of the first page: none, the server starts at the first entry. */
const FIRST_PAGE: string | undefined = undefined;

/** The cursor of the next page, or `undefined` on the last one. */
const nextPageOf = (page: AllowlistPage): string | undefined => page.nextCursor ?? undefined;

/**
 * The entries of one scope (E14-S07), 200 at a time: `GET .../installations/:installationId/allowlist-entries` for the whole installation
 * (`repositoryId` is `undefined`) and `GET .../repositories/:repositoryId/allowlist-entries` for one repository. The key names the
 * installation of the address and the scope, so the entries are dropped with their tenant and one scope's pages are never another's.
 */
export function entriesQueryOptions(client: ApiClient, installationId: number, repositoryId: number | undefined) {
  return infiniteQueryOptions({
    queryKey: [...allowlistKey(installationId), repositoryId ?? 'installation'] as const,
    queryFn: ({ pageParam, signal }) => readPage({ client, installationId, repositoryId, cursor: pageParam, signal }),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: nextPageOf,
    select: viewOf,
  });
}
