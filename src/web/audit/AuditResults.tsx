// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../auth/hooks.ts';
import { useT } from '../i18n/index.ts';
import { EmptyState } from '../states/EmptyState.tsx';
import { StatusMessage } from '../ui/index.ts';
import { PagedResults } from '../ui/PagedResults.tsx';
import { AuditTable } from './AuditTable.tsx';
import { type AuditFilters, isFiltered } from './audit-filters.ts';
import { auditQueryOptions } from './audit-queries.ts';

export interface AuditResultsProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  readonly filters: AuditFilters;
  /** `?cursor=` of the address: absent for the first page. */
  readonly cursor: string | undefined;
  readonly onCursorChange: (cursor: string | undefined) => void;
  readonly onFirstPage: () => void;
}

/**
 * The page of the log that the address names (E18-S09): the number of events on it in a polite live region, the table, and the
 * pager, with no total, because the endpoint counts none. It is made for one installation and one set of filters and is remounted for
 * another, so the rows of one are never on screen for the other and the pager starts again. Loading, a `403` or the uniform `404` on
 * the first load, a refetch that fails and the empty state come from `PagedResults`.
 */
export function AuditResults({ installationId, filters, cursor, onCursorChange, onFirstPage }: AuditResultsProps) {
  const t = useT();
  const query = useQuery(auditQueryOptions(useApiClient(), installationId, { filters, cursor }));
  const filtered = isFiltered(filters);
  return (
    <PagedResults
      query={query}
      cursor={cursor}
      onCursorChange={onCursorChange}
      onFirstPage={onFirstPage}
      title={t('audit.results.title')}
      status={(shown) => (
        <StatusMessage>{shown === undefined ? null : t.plural('audit.count', shown.items.length)}</StatusMessage>
      )}
      empty={
        <EmptyState
          level={3}
          title={t(filtered ? 'audit.empty.filtered.title' : 'audit.empty.none.title')}
          description={t(filtered ? 'audit.empty.filtered.description' : 'audit.empty.none.description')}
        />
      }
      rows={(page) => <AuditTable items={page.items} />}
    />
  );
}
