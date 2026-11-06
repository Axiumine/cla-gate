// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { QueryBoundary } from '../states/QueryBoundary.tsx';
import type { PagerPage } from './ResultsPager.tsx';

export interface PagedListingProps<Page extends PagerPage> {
  readonly query: UseQueryResult<Page>;
  /** The page that stays on screen when the page asked for could not be loaded. */
  readonly keptPage: Page | undefined;
  /** What stands in for the rows when the page holds none (an `EmptyState`). */
  readonly empty: ReactElement;
  readonly rows: (page: Page) => ReactElement;
}

/**
 * The rows of a paged list (E18-S07, E18-S08), or the state that stands in for them: loading, the error of the first load, or nothing
 * found. A page that is kept because the next one failed is shown as it is; the pager under it says what happened.
 */
export function PagedListing<Page extends PagerPage>({ query, keptPage, empty, rows }: PagedListingProps<Page>) {
  return keptPage === undefined ? (
    <QueryBoundary query={query} isEmpty={(page) => page.items.length === 0} empty={empty} errorLevel={3}>
      {rows}
    </QueryBoundary>
  ) : (
    rows(keptPage)
  );
}
