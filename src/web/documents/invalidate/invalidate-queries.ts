// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { queryOptions } from '@tanstack/react-query';
import { invalidationPreviewRoute } from '../../../shared/signature-invalidate-routes.ts';
import type { ApiClient } from '../../api/index.ts';
import { type DocumentIds, documentKey } from '../document-queries.ts';

// The query behind the invalidation question (E18-S14). Its key starts with `['installation', installationId, 'documents', documentId]`
// (E18-S04, E18-S05), so the count of one document of one tenant is kept and dropped as a unit and never found under another.

/** The key of the preview of one major of one document: what an invalidation, or a count that changed, makes out of date. */
export function invalidationPreviewKey(ids: DocumentIds, major: number) {
  return [...documentKey(ids), 'invalidation-preview', major] as const;
}

/**
 * `GET .../documents/:documentId/invalidation-preview?major=` (E15-S04): how many signatures of the major are in force and how many
 * repositories would be checked again, counts only. A count is an answer for the moment it was given, so it is never reused: it is asked
 * for again whenever the question opens (`staleTime: 0`), dropped the moment the question closes (`gcTime: 0`), and not asked for
 * again behind the person's back when the window gets focus, because a number that changes under a confirmation they are reading is
 * what `count_changed` is for.
 */
export function invalidationPreviewQueryOptions(client: ApiClient, ids: DocumentIds, major: number) {
  return queryOptions({
    queryKey: invalidationPreviewKey(ids, major),
    queryFn: ({ signal }) =>
      client.call(
        invalidationPreviewRoute,
        { params: { installationId: ids.installationId, documentId: ids.documentId }, query: { major } },
        { signal },
      ),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
