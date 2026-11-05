// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useT } from '../i18n/index.ts';
import { EmptyState } from '../states/EmptyState.tsx';
import { QueryBoundary } from '../states/QueryBoundary.tsx';
import { type Filters, isFiltered } from './signature-filters.ts';
import type { SignaturePage } from './signature-queries.ts';

export interface SignatureListingProps {
  readonly query: UseQueryResult<SignaturePage>;
  /** The page that stays on screen when the page asked for could not be loaded. */
  readonly keptPage: SignaturePage | undefined;
  readonly filters: Filters;
  readonly rows: (page: SignaturePage) => ReactElement;
}

/** The table of the page (E18-S07), or the state that stands in for it: loading, the error of the first load, or nothing found. */
export function SignatureListing({ query, keptPage, filters, rows }: SignatureListingProps) {
  const t = useT();
  return keptPage === undefined ? (
    <QueryBoundary
      query={query}
      isEmpty={(page) => page.items.length === 0}
      empty={
        <EmptyState
          level={3}
          title={t('signatures.empty.title')}
          description={t(isFiltered(filters) ? 'signatures.empty.filtered' : 'signatures.empty.none')}
        />
      }
      errorLevel={3}
    >
      {rows}
    </QueryBoundary>
  ) : (
    rows(keptPage)
  );
}
