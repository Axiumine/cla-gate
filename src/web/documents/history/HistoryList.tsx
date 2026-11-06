// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../auth/hooks.ts';
import { useT } from '../../i18n/index.ts';
import { EmptyState } from '../../states/EmptyState.tsx';
import { LoadingState } from '../../states/LoadingState.tsx';
import { PagedListing } from '../../ui/PagedListing.tsx';
import { ResultsPager } from '../../ui/ResultsPager.tsx';
import { usePagedList } from '../../ui/use-paged-list.ts';
import type { DocumentIds } from '../document-queries.ts';
import type { InvalidateControl } from '../invalidate/use-invalidate-control.ts';
import { versionPageQueryOptions } from './history-queries.ts';
import { VersionsTable } from './VersionsTable.tsx';

export interface HistoryListProps {
  readonly ids: DocumentIds;
  /** `?cursor=` of the address: absent for the first page. */
  readonly cursor: string | undefined;
  readonly onCursorChange: (cursor: string | undefined) => void;
  /** Replaces the address with the first page. */
  readonly onFirstPage: () => void;
  readonly onView: (versionId: number) => void;
  /** The invalidation of a major on its first version, for a viewer who may manage the document. */
  readonly invalidate: InvalidateControl | undefined;
}

/**
 * The page of the history that the address names (E18-S11): the table, or the state that stands in for it (loading, the error of the
 * first load, a `403` or the uniform `404`, and a document that has no version yet), and the pager, with no total, because the endpoint
 * counts none. The page on screen stays while the next one loads, and when it fails to load the pager says so. A cursor the server
 * refuses is answered with the first page.
 */
export function HistoryList({ ids, cursor, onCursorChange, onFirstPage, onView, invalidate }: HistoryListProps) {
  const t = useT();
  const query = useQuery(versionPageQueryOptions(useApiClient(), ids, cursor));
  const { shown, keptPage, cursorRefused, goTo } = usePagedList(query, { cursor, onCursorChange, onFirstPage });
  return (
    <div className="flex flex-col gap-4">
      {cursorRefused ? (
        <LoadingState />
      ) : (
        <PagedListing
          query={query}
          keptPage={keptPage}
          empty={<EmptyState level={3} title={t('history.empty.title')} description={t('history.empty.description')} />}
          rows={(page) => <VersionsTable items={page.items} onView={onView} invalidate={invalidate} />}
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
