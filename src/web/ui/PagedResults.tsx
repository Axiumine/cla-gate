// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { useRef } from 'react';
import { LoadingState } from '../states/LoadingState.tsx';
import { Heading } from './index.ts';
import { PagedListing } from './PagedListing.tsx';
import { type PagerPage, ResultsPager } from './ResultsPager.tsx';
import { usePagedList } from './use-paged-list.ts';

export interface PagedResultsProps<Page extends PagerPage> {
  readonly query: UseQueryResult<Page>;
  /** `?cursor=` of the address: absent for the first page. */
  readonly cursor: string | undefined;
  readonly onCursorChange: (cursor: string | undefined) => void;
  readonly onFirstPage: () => void;
  /** The level-two heading of the results, which takes focus when a row is gone. */
  readonly title: string;
  /** The polite live regions under the heading; they read the page on screen, once there is one. */
  readonly status: (shown: Page | undefined) => ReactNode;
  /** What stands in for the rows when the page holds none (an `EmptyState`). */
  readonly empty: ReactElement;
  /** The table of a page. `focusHeading` is for when a row and its button are gone. */
  readonly rows: (page: Page, focusHeading: () => void) => ReactElement;
}

/**
 * The results of a paged list that the address names (E18-S07, E18-S08): a heading, the live regions of `status`, the rows or the state
 * that stands in for them, and the pager with no total, because the endpoints count none. Loading, the error of the first load and
 * nothing found come from `QueryBoundary`; a page that is kept because the next one failed is shown as it is, and the pager under it
 * says what happened. A cursor the server refuses is answered with the first page. It is made for one installation and one search and
 * is remounted for another, so the rows of one are never on screen for the other and the pager starts again.
 */
export function PagedResults<Page extends PagerPage>({
  query,
  cursor,
  onCursorChange,
  onFirstPage,
  title,
  status,
  empty,
  rows,
}: PagedResultsProps<Page>) {
  const { shown, keptPage, cursorRefused, goTo } = usePagedList(query, { cursor, onCursorChange, onFirstPage });
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <div className="flex flex-col gap-4">
      <Heading level={2} ref={heading} focusable>
        {title}
      </Heading>
      {status(shown)}
      {cursorRefused ? (
        <LoadingState />
      ) : (
        <PagedListing
          query={query}
          keptPage={keptPage}
          empty={empty}
          rows={(page) =>
            rows(page, () => {
              heading.current?.focus();
            })
          }
        />
      )}
      <ResultsPager
        shown={shown}
        cursor={cursor}
        onCursorChange={goTo}
        loading={query.isFetching}
        failed={keptPage !== undefined}
      />
    </div>
  );
}
