// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { HeadingLevel } from '../ui/Heading.tsx';
import { ErrorState } from './ErrorState.tsx';
import { LoadingState } from './LoadingState.tsx';

/** What to do when the data is there but holds nothing: `isEmpty` says so, `empty` is what to show (an `EmptyState`). Both or neither. */
type EmptyRule<Data> =
  | { readonly isEmpty?: undefined; readonly empty?: undefined }
  | { readonly isEmpty: (data: Data) => boolean; readonly empty: ReactNode };

export type QueryBoundaryProps<Data> = EmptyRule<Data> & {
  readonly query: UseQueryResult<Data>;
  /** The heading level of the error state that replaces the screen: 1 on a page that has no heading of its own before the data is there (E18-S04). */
  readonly errorLevel?: HeadingLevel;
  /** The screen for the data. It runs only once there is data, so it never has to handle `undefined`. */
  readonly children: (data: Data) => ReactNode;
};

/**
 * Turns the result of a query into one of four screens (E17-S07): loading until the first answer, an error when the first
 * answer failed, the empty state when `isEmpty` says the data holds nothing, and the data. When a later refetch fails the
 * data stays on screen and an inline banner is added above it: a page that was working is never swapped for an error, and
 * the banner's "Try again" repeats the request. Nothing here moves focus: an error is announced as an alert, and data
 * replacing the loading state is not announced at all.
 */
export function QueryBoundary<Data>({ query, errorLevel = 2, isEmpty, empty, children }: QueryBoundaryProps<Data>) {
  const data = query.data;
  if (data === undefined) {
    return query.isError ? (
      <ErrorState error={query.error} refetch={query.refetch} retrying={query.isFetching} level={errorLevel} />
    ) : (
      <LoadingState />
    );
  }
  const stale = query.isError ? (
    <ErrorState variant="banner" error={query.error} refetch={query.refetch} retrying={query.isFetching} />
  ) : null;
  return (
    <>
      {stale}
      {isEmpty?.(data) === true ? empty : children(data)}
    </>
  );
}
