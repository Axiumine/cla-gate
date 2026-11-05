// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { UseQueryResult } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ApiError } from '../api/index.ts';
import { useSettled } from './use-cursor-trail.ts';

const BAD_REQUEST = 400;

/**
 * Whether the server refused the request itself. The only thing a paged screen varies in it that can be wrong is the cursor (the page
 * size is a constant in range), so a `400` on a first load means the cursor in the address is not one the server made.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function isRefusedCursor(error: unknown): boolean {
  return error instanceof ApiError && error.status === BAD_REQUEST;
}

/** What a paged screen does about the page of its list that the address names (E18-S03, E18-S07). */
export interface PagedListInput {
  /** `?cursor=` of the address: absent for the first page. */
  readonly cursor: string | undefined;
  /** Puts another page in the address. */
  readonly onCursorChange: (cursor: string | undefined) => void;
  /** Replaces the address with the first page. */
  readonly onFirstPage: () => void;
}

/**
 * What a paged screen needs to know about the query of the page its address names. `shown` is the last page that arrived: a request in
 * flight or one that failed does not take it away. `keptPage` is that page while a page asked for from it could not be loaded (the
 * pager says so and the page on screen stays), and `undefined` otherwise. `cursorRefused` is a first load, with a cursor, that the
 * server answered with a `400` (a reload, a pasted link): it is answered with the first page, by replacing the address, so Back does
 * not return to a cursor that leads nowhere. `goTo` is for the pager: a page that failed is asked for by the cursor the address already
 * holds, which is no change of address, so it is asked again here.
 */
export function usePagedList<Page>(
  query: UseQueryResult<Page>,
  { cursor, onCursorChange, onFirstPage }: PagedListInput,
) {
  const shown = useSettled(query.data, query.isSuccess && !query.isPlaceholderData);
  const keptPage = query.data === undefined && query.isError ? shown : undefined;
  const cursorRefused = cursor !== undefined && shown === undefined && isRefusedCursor(query.error);
  useEffect(() => {
    if (cursorRefused) {
      onFirstPage();
    }
  }, [cursorRefused, onFirstPage]);
  const goTo = (target: string | undefined) => {
    if (target === cursor) {
      void query.refetch();
    } else {
      onCursorChange(target);
    }
  };
  return { shown, keptPage, cursorRefused, goTo };
}
