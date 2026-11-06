// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../auth/index.ts';
import { type PagedListInput, usePagedList } from '../ui/use-paged-list.ts';
import { mySignaturesQueryOptions } from './signatures-queries.ts';

/** What the screen does about the page of the list that the address names (E18-S03). */
export type SignaturesPageInput = PagedListInput;

/**
 * The page of the list for the cursor of the address (E18-S03), and what the screen needs to know about it: the query, and the page on
 * screen, the page kept after a failed one, the refused cursor and the pager's move, as `usePagedList` tells them.
 */
export function useSignaturesPage(input: SignaturesPageInput) {
  const query = useQuery(mySignaturesQueryOptions(useApiClient(), input.cursor));
  return { query, ...usePagedList(query, input) };
}
