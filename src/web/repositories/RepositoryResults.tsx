// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApiClient } from '../auth/hooks.ts';
import { useT } from '../i18n/index.ts';
import { EmptyState } from '../states/EmptyState.tsx';
import { PagedResults } from '../ui/PagedResults.tsx';
import { RepositoriesTable } from './RepositoriesTable.tsx';
import { ResultStatus } from './ResultStatus.tsx';
import { type Filters, isFiltered } from './repository-filters.ts';
import { repositoriesQueryOptions } from './repository-queries.ts';
import type { RowActions } from './row-actions.ts';
import type { RepositoryOutcome } from './use-repository-change.ts';

export interface RepositoryResultsProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  readonly filters: Filters;
  /** `?cursor=` of the address: absent for the first page. */
  readonly cursor: string | undefined;
  readonly onCursorChange: (cursor: string | undefined) => void;
  readonly onFirstPage: () => void;
  /** What the viewer may do with the rows they administer. */
  readonly actions: Omit<RowActions, 'onOutcome' | 'onVanished'>;
}

/**
 * The page of the search that the address names (E18-S10): the number of repositories on it in a polite live region (so a search is
 * announced), what the last change did, the table, and the pager, with no total, because the endpoint counts none. It is made for one
 * installation and one search and is remounted for another, so the rows of one are never on screen for the other and the pager
 * starts again. A `403`, the uniform `404` and a failed first load replace the table with that state and no row; a page that fails
 * to load while one is on screen leaves it there and the pager says so.
 */
export function RepositoryResults({
  installationId,
  filters,
  cursor,
  onCursorChange,
  onFirstPage,
  actions,
}: RepositoryResultsProps) {
  const t = useT();
  const query = useQuery(repositoriesQueryOptions(useApiClient(), installationId, { filters, cursor }));
  const [notice, setNotice] = useState<RepositoryOutcome | undefined>(undefined);
  return (
    <PagedResults
      query={query}
      cursor={cursor}
      onCursorChange={onCursorChange}
      onFirstPage={onFirstPage}
      title={t('repositories.results.title')}
      status={(shown) => <ResultStatus shown={shown} notice={notice} />}
      empty={
        <EmptyState
          level={3}
          title={t('repositories.empty.title')}
          description={t(isFiltered(filters) ? 'repositories.empty.filtered' : 'repositories.empty.none')}
        />
      }
      rows={(page, focusHeading) => (
        <RepositoriesTable
          items={page.items}
          actions={{ ...actions, onOutcome: setNotice, onVanished: focusHeading }}
        />
      )}
    />
  );
}
