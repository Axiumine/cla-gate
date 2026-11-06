// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { queryOptions } from '@tanstack/react-query';
import { erasurePreviewRoute } from '../../../shared/erasure-routes.ts';
import type { ApiClient } from '../../api/index.ts';
import { installationKey } from '../../installations/installation-queries.ts';

// The query behind the erasure question (E18-S14). Its key starts with `['installation', installationId]` (E18-S04), so what an erasure
// would remove in one tenant is kept and dropped as a unit and never found under another tenant's key.

/** The key of the preview of the erasure of one person in one installation: what an erasure, or a count that changed, makes out of date. */
export function erasurePreviewKey(installationId: number, githubUserId: number) {
  return [...installationKey(installationId), 'erasure-preview', githubUserId] as const;
}

/**
 * `GET .../installations/:installationId/erasure-preview?githubUserId=` (E16-S04): how many signatures the person has in the installation,
 * how many rows of personal data are held for them and how many allowlist entries name them, counts and the numeric id only. A count is an
 * answer for the moment it was given, so it is never reused: it is asked for again whenever the question opens (`staleTime: 0`), dropped
 * the moment the question closes (`gcTime: 0`), and not asked for again behind the person's back when the window gets focus.
 */
export function erasurePreviewQueryOptions(client: ApiClient, installationId: number, githubUserId: number) {
  return queryOptions({
    queryKey: erasurePreviewKey(installationId, githubUserId),
    queryFn: ({ signal }) =>
      client.call(erasurePreviewRoute, { params: { installationId }, query: { githubUserId } }, { signal }),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
