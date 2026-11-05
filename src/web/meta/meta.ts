// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { queryOptions, useQuery } from '@tanstack/react-query';
import { metaRoute } from '../../shared/meta.ts';
import type { ApiClient } from '../api/index.ts';
import { useApiClient } from '../auth/hooks.ts';
import { type InstallLink, installLinkOf } from './install-link.ts';
import { type SourceLink, sourceLinkOf } from './source-link.ts';

// What the instance says about itself (E17-S09), read once and kept in the query cache.

/**
 * The key of the meta query.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const META_KEY = ['meta'] as const;

/** The server lets the answer be kept for five minutes; so does the cache. The commit changes only with a deployment. */
const META_STALE_TIME_MS = 300_000;

/** The meta query: `GET /api/meta` through the typed client. It needs no session. */
function metaQueryOptions(client: ApiClient) {
  return queryOptions({
    queryKey: META_KEY,
    queryFn: ({ signal }) => client.call(metaRoute, undefined, { signal }),
    staleTime: META_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });
}

/**
 * The source link for the footer. It never waits and never fails: until the answer arrives, and whenever the request fails or
 * the answer is not the contract's (a source address that is not https, say), it is the link to the compiled-in repository.
 */
export function useSourceLink(): SourceLink {
  return sourceLinkOf(useQuery(metaQueryOptions(useApiClient())).data);
}

/**
 * What the instance offers for installing the GitHub App (E18-S04), from the same cached answer as the footer: a link, "finish
 * the setup first", or nothing known yet.
 */
export function useInstallLink(): InstallLink {
  return installLinkOf(useQuery(metaQueryOptions(useApiClient())).data);
}
