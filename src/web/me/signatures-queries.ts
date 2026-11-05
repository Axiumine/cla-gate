// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { ownSignaturesRoute } from '../../shared/own-signatures.ts';
import type { ApiClient } from '../api/index.ts';

// The query of the "my signatures" screen (E18-S03): one page of the signed-in person's own signatures.

/**
 * How many signatures a page holds: the endpoint takes 1 to 100 and answers 50 when the request names none.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const MY_SIGNATURES_PAGE_SIZE = 25;

/**
 * `GET /api/me/signatures?limit=25&cursor=` (E13-S06). The request names a page and nothing else: the person is the one of the
 * session, so no id, login or e-mail goes in the address. A page is kept in the cache under its cursor, and the page on screen stays
 * until the next one is there. The answer is asked for again on every visit (a signature made in the sign page since the last visit
 * is listed), and the cache is cleared on logout, so a list never outlives the session it was read for.
 */
export function mySignaturesQueryOptions(client: ApiClient, cursor: string | undefined) {
  return queryOptions({
    queryKey: ['me', 'signatures', cursor ?? null] as const,
    queryFn: ({ signal }) =>
      client.call(ownSignaturesRoute, { query: { limit: MY_SIGNATURES_PAGE_SIZE, cursor } }, { signal }),
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
}
