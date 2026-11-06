// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { installationRepositoriesRoute, type RepositoryPage } from '../../shared/installations.ts';
import type { ApiClient } from '../api/index.ts';
import { installationKey } from '../installations/installation-queries.ts';
import type { Filters } from './repository-filters.ts';

// The queries of the Repositories screen (E18-S10). Every key starts with `['installation', installationId]` (E18-S04), so the
// repositories of one tenant are kept and dropped as a unit and never found under another tenant's key.

/** One repository of a page, as the endpoint sends it. */
export type Repository = RepositoryPage['items'][number];

/** The CLA document a repository enforces, as the list shows it: never its text. */
export type AttachedDocument = NonNullable<Repository['document']>;

/**
 * How many repositories a page holds: the endpoint takes 1 to 100 and this screen asks for 50, which is also its default.
 *
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const REPOSITORIES_PAGE_SIZE = 50;

/** The start of the key of every query about the repositories of one installation: what an attach, an enable or a disable makes out of date. */
export function repositoriesKey(installationId: number) {
  return [...installationKey(installationId), 'repositories'] as const;
}

/** What a page is asked for: the filters of the address and the cursor of the page. */
export interface RepositoryListRequest {
  readonly filters: Filters;
  readonly cursor: string | undefined;
}

/** The `enabled` of the endpoint for a filter: the two words it takes, and nothing for no filter. */
function enabledQuery(enabled: boolean | undefined): 'true' | 'false' | undefined {
  if (enabled === undefined) {
    return undefined;
  }
  return enabled ? 'true' : 'false';
}

/**
 * `GET /api/installations/:installationId/repositories?limit=50&q=&enabled=&cursor=` (E14-S01). The search and the filter are those of the
 * address, and the installation is the one in the path, which the server filters every row by. A page is kept under the filters and its
 * cursor; the page on screen stays until the next one of the same search is there (the screen is remounted for another installation or
 * another search, so it never shows the rows of another one), and the answer is asked for again on every visit: a change made since is listed as it is.
 */
export function repositoriesQueryOptions(
  client: ApiClient,
  installationId: number,
  { filters, cursor }: RepositoryListRequest,
) {
  return queryOptions({
    queryKey: [
      ...repositoriesKey(installationId),
      'list',
      filters.q ?? null,
      filters.enabled ?? null,
      cursor ?? null,
    ] as const,
    queryFn: ({ signal }) =>
      client.call(
        installationRepositoriesRoute,
        {
          params: { installationId },
          query: {
            limit: String(REPOSITORIES_PAGE_SIZE),
            q: filters.q,
            enabled: enabledQuery(filters.enabled),
            cursor,
          },
        },
        { signal },
      ),
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
}
