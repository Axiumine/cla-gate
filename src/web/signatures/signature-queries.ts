// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { SuccessOf } from '../../shared/contract.ts';
import { signatureSearchRoute } from '../../shared/signature-routes.ts';
import type { ApiClient } from '../api/index.ts';
import { installationKey } from '../installations/installation-queries.ts';
import { exactFilterOf, type Filters } from './signature-filters.ts';

// The query of the signatures screen (E18-S07). Every key starts with `['installation', installationId]` (E18-S04), so the signatures of
// one tenant are kept and dropped as a unit and never found under another tenant's key.

/** One page of the search, as the endpoint sends it. */
export type SignaturePage = SuccessOf<typeof signatureSearchRoute>;

/** One signature of a page. */
export type Signature = SignaturePage['items'][number];

/**
 * How many signatures a page holds: the endpoint takes 1 to 100 and this screen asks for 50, which is also its default.
 *
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const SIGNATURES_PAGE_SIZE = 50;

/** The start of the key of every query about the signatures of one installation: what a revocation makes out of date. */
export function signaturesKey(installationId: number) {
  return [...installationKey(installationId), 'signatures'] as const;
}

/** What a page is asked for: the filters of the address and the cursor of the page. */
export interface SignatureListRequest {
  readonly filters: Filters;
  readonly cursor: string | undefined;
}

/**
 * `GET /api/installations/:installationId/signatures?limit=50&state=&documentId=&githubUserId=&login=&cursor=` (E15-S02). The search
 * text is one of the two exact filters (`exactFilterOf`), the state and the document are the filters of the address, and the
 * installation is the one in the path, which the server filters every row by. A page is kept under the filters and its cursor; the
 * page on screen stays until the next one of the same search is there (the screen is remounted for another installation or another
 * search, so it never shows the rows of another one), and the answer is asked for again on every visit: a signature made or
 * revoked since is listed as it is.
 */
export function signaturesQueryOptions(
  client: ApiClient,
  installationId: number,
  { filters, cursor }: SignatureListRequest,
) {
  const { githubUserId, login } = exactFilterOf(filters.q);
  return queryOptions({
    queryKey: [
      ...signaturesKey(installationId),
      filters.q ?? null,
      filters.state ?? null,
      filters.document ?? null,
      cursor ?? null,
    ] as const,
    queryFn: ({ signal }) =>
      client.call(
        signatureSearchRoute,
        {
          params: { installationId },
          query: {
            limit: SIGNATURES_PAGE_SIZE,
            state: filters.state,
            documentId: filters.document,
            githubUserId,
            login,
            cursor,
          },
        },
        { signal },
      ),
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
}
