// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useApiClient } from '../auth/hooks.ts';
import { useT } from '../i18n/index.ts';
import { LoadingState } from '../states/LoadingState.tsx';
import { Heading } from '../ui/index.ts';
import { usePagedList } from '../ui/use-paged-list.ts';
import { ResultStatus } from './ResultStatus.tsx';
import { ResultsPager } from './ResultsPager.tsx';
import { SignatureListing } from './SignatureListing.tsx';
import { type RevokeControl, SignaturesTable } from './SignaturesTable.tsx';
import type { Filters } from './signature-filters.ts';
import { type SignaturePage, signaturesQueryOptions } from './signature-queries.ts';
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
  const { shown, keptPage, cursorRefused, goTo } = usePagedList(query, { cursor, onCursorChange, onFirstPage });
  const [notice, setNotice] = useState<RevokeOutcome | undefined>(undefined);
  const heading = useRef<HTMLHeadingElement>(null);
  const rows = (page: SignaturePage) => (
    <SignaturesTable
      items={page.items}
      revoke={{
        ...revoke,
        onOutcome: setNotice,
        onVanished: () => {
          heading.current?.focus();
        },
      }}
    />
  );
  return (
    <div className="flex flex-col gap-4">
      <Heading level={2} ref={heading} focusable>
        {t('signatures.results.title')}
      </Heading>
      <ResultStatus shown={shown} notice={notice} />
      {cursorRefused ? (
        <LoadingState />
      ) : (
        <SignatureListing query={query} keptPage={keptPage} filters={filters} rows={rows} />
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
