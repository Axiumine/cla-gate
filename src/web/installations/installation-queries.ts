// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { queryOptions } from '@tanstack/react-query';
import { installationListRoute, installationRepositoriesRoute } from '../../shared/installations.ts';
import type { ApiClient } from '../api/index.ts';

// The queries of the installation screens (E18-S04). The list of installations belongs to the person; everything else belongs
// to one tenant, and the key of every such query starts with `['installation', installationId]`, so a tenant's data is found,
// kept and dropped as a unit, and the data of one tenant can never be read under the key of another. No query here uses
// `placeholderData`: when the installation changes, the screen shows loading until the new tenant's answer is there.

/**
 * The key of the list of installations the person administers: the person's, not a tenant's.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const INSTALLATIONS_KEY = ['installations'] as const;

/** The start of the key of every query that belongs to one installation. */
export function installationKey(installationId: number) {
  return ['installation', installationId] as const;
}

/**
 * How many repositories the overview of an installation lists: a glance at the tenant, not the repository screen (E18-S10).
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const OVERVIEW_REPOSITORIES = 10;

/** `GET /api/installations` (E14-S01) through the typed client. */
export function installationsQueryOptions(client: ApiClient) {
  return queryOptions({
    queryKey: INSTALLATIONS_KEY,
    queryFn: ({ signal }) => client.call(installationListRoute, undefined, { signal }),
  });
}

/** `GET /api/installations/:installationId/repositories?limit=10` (E14-S01): the first repositories of one tenant. */
export function overviewQueryOptions(client: ApiClient, installationId: number) {
  return queryOptions({
    queryKey: [...installationKey(installationId), 'repositories', { limit: OVERVIEW_REPOSITORIES }] as const,
    queryFn: ({ signal }) =>
      client.call(
        installationRepositoriesRoute,
        { params: { installationId }, query: { limit: String(OVERVIEW_REPOSITORIES) } },
        { signal },
      ),
  });
}
