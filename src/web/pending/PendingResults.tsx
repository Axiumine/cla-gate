// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApiClient } from '../auth/hooks.ts';
import { useT } from '../i18n/index.ts';
import { PagedResults } from '../ui/PagedResults.tsx';
import { NoPendingPrs } from './NoPendingPrs.tsx';
import { PendingStatus } from './PendingStatus.tsx';
import { PendingTable } from './PendingTable.tsx';
import { type PendingRequest, pendingQueryOptions } from './pending-queries.ts';

export interface PendingResultsProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  /** The filters of the address. */
  readonly filters: Pick<PendingRequest, 'repository' | 'reason'>;
  /** `?cursor=` of the address: absent for the first page. */
  readonly cursor: string | undefined;
  readonly onCursorChange: (cursor: string | undefined) => void;
  readonly onFirstPage: () => void;
  /** Whether the installation is suspended: no override is recorded then. */
  readonly suspended: boolean;
}

/**
 * The page of the pending list that the address names (E18-S08): the number of pull requests on it in a polite live region, what was
 * done with an override, the table and the pager, with no total, because the endpoint counts none. It is made for one installation and
 * one set of filters and is remounted for another, so the rows of one are never on screen for the other. Loading, the error of the
 * first load (a `403`, the uniform `404`), a refetch that fails and the empty state come from `PagedResults`.
 */
export function PendingResults({
  installationId,
  filters,
  cursor,
  onCursorChange,
  onFirstPage,
  suspended,
}: PendingResultsProps) {
  const t = useT();
  const query = useQuery(pendingQueryOptions(useApiClient(), installationId, { ...filters, cursor }));
  const [recorded, setRecorded] = useState(false);
  const filtered = filters.repository !== undefined || filters.reason !== undefined;
  return (
    <PagedResults
      query={query}
      cursor={cursor}
      onCursorChange={onCursorChange}
      onFirstPage={onFirstPage}
      title={t('pending.results.title')}
      status={(shown) => <PendingStatus shown={shown} recorded={recorded} />}
      empty={<NoPendingPrs filtered={filtered} />}
      rows={(page, focusHeading) => (
        <PendingTable
          items={page.items}
          actions={{
            installationId,
            suspended,
            onRecorded: () => {
              setRecorded(true);
            },
            onVanished: focusHeading,
          }}
        />
      )}
    />
  );
}
