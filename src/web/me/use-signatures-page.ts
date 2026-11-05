// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useApiClient } from '../auth/index.ts';
import { useSettled } from '../ui/use-cursor-trail.ts';
import { isRefusedCursor, mySignaturesQueryOptions } from './signatures-queries.ts';

/** What the screen does about the page of the list that the address names (E18-S03). */
export interface SignaturesPageInput {
  /** `?cursor=` of the address: absent for the first page. */
  readonly cursor: string | undefined;
  /** Puts another page in the address. */
  readonly onCursorChange: (cursor: string | undefined) => void;
  /** Replaces the address with the first page. */
  readonly onFirstPage: () => void;
}

/**
 * The page of the list for the cursor of the address (E18-S03), and what the screen needs to know about it. `shown` is the last
 * page that arrived: a request in flight or one that failed does not take it away. `keptPage` is that page while a page asked
 * for from it could not be loaded (the pager says so and the page on screen stays), and `undefined` otherwise. `cursorRefused` is a first
 * load, with a cursor, that the server answered with a `400` (a reload, a pasted link): it is answered with the first page, by
 * replacing the address, so Back does not return to a cursor that leads nowhere. `goTo` is for the pager: a page that failed is
 * asked for by the cursor the address already holds, which is no change of address, so it is asked again here.
 */
export function useSignaturesPage({ cursor, onCursorChange, onFirstPage }: SignaturesPageInput) {
  const query = useQuery(mySignaturesQueryOptions(useApiClient(), cursor));
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
  return { query, shown, keptPage, cursorRefused, goTo };
}
