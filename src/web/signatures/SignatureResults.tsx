// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApiClient } from '../auth/hooks.ts';
import { useT } from '../i18n/index.ts';
import { EmptyState } from '../states/EmptyState.tsx';
import { PagedResults } from '../ui/PagedResults.tsx';
import { ResultStatus } from './ResultStatus.tsx';
import { type RevokeControl, SignaturesTable } from './SignaturesTable.tsx';
import { type Filters, isFiltered } from './signature-filters.ts';
import { signaturesQueryOptions } from './signature-queries.ts';
import type { RevokeOutcome } from './use-revoke-signature.ts';

export interface SignatureResultsProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  readonly filters: Filters;
  /** `?cursor=` of the address: absent for the first page. */
  readonly cursor: string | undefined;
  readonly onCursorChange: (cursor: string | undefined) => void;
  readonly onFirstPage: () => void;
  /** What the viewer may do with the rows: which documents they may revoke the signatures of, and whether the revocation is off. */
  readonly revoke: Omit<RevokeControl, 'onOutcome' | 'onVanished'>;
}

/**
 * The page of the search that the address names (E18-S07): the number of signatures on it in a polite live region (so a search is
 * announced), what the last revocation did, the table, and the pager, with no total, because the endpoint counts none. It is
 * made for one installation and one search and is remounted for another, so the rows of one are never on screen for the other and
 * the pager starts again. A `403`, the uniform `404` and a failed first load replace the table with that state and no row; a page
 * that fails to load while one is on screen leaves it there and the pager says so.
 */
export function SignatureResults({
  installationId,
  filters,
  cursor,
  onCursorChange,
  onFirstPage,
  revoke,
}: SignatureResultsProps) {
  const t = useT();
  const query = useQuery(signaturesQueryOptions(useApiClient(), installationId, { filters, cursor }));
  const [notice, setNotice] = useState<RevokeOutcome | undefined>(undefined);
  return (
    <PagedResults
      query={query}
      cursor={cursor}
      onCursorChange={onCursorChange}
      onFirstPage={onFirstPage}
      title={t('signatures.results.title')}
      status={(shown) => <ResultStatus shown={shown} notice={notice} />}
      empty={
        <EmptyState
          level={3}
          title={t('signatures.empty.title')}
          description={t(isFiltered(filters) ? 'signatures.empty.filtered' : 'signatures.empty.none')}
        />
      }
      rows={(page, focusHeading) => (
        <SignaturesTable items={page.items} revoke={{ ...revoke, onOutcome: setNotice, onVanished: focusHeading }} />
      )}
    />
  );
}
