// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApiClient } from '../auth/hooks.ts';
import { useT } from '../i18n/index.ts';
import { EmptyState } from '../states/EmptyState.tsx';
import { StatusMessage } from '../ui/index.ts';
import { PagedResults } from '../ui/PagedResults.tsx';
import { OverridesTable } from './OverridesTable.tsx';
import { overridesQueryOptions } from './pending-queries.ts';
import type { RemovalOutcome } from './use-remove-override.ts';

export interface OverrideResultsProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  /** `repositories.id` of the repository chosen: one of this installation's. */
  readonly repositoryId: number;
  /** `?cursor=` of the address: absent for the first page. */
  readonly cursor: string | undefined;
  readonly onCursorChange: (cursor: string | undefined) => void;
  readonly onFirstPage: () => void;
  /** Whether the installation is suspended: no override is removed then. */
  readonly suspended: boolean;
}

/**
 * The page of the overrides of the repository chosen (E18-S08): how many are on it and what the last removal did in polite live
 * regions, the table and the pager, with no total. It is made for one installation and one repository and is remounted for another.
 * An error (a `403` for a repo admin whose repository enforces the document of the installation, the uniform `404`) and the empty
 * state come from `PagedResults`; after a removal focus goes to the results heading, because the row and its button are gone.
 */
export function OverrideResults({
  installationId,
  repositoryId,
  cursor,
  onCursorChange,
  onFirstPage,
  suspended,
}: OverrideResultsProps) {
  const t = useT();
  const query = useQuery(overridesQueryOptions(useApiClient(), installationId, repositoryId, cursor));
  const [notice, setNotice] = useState<RemovalOutcome | undefined>(undefined);
  return (
    <PagedResults
      query={query}
      cursor={cursor}
      onCursorChange={onCursorChange}
      onFirstPage={onFirstPage}
      title={t('pending.results.title')}
      status={(shown) => (
        <>
          <StatusMessage>
            {shown === undefined ? null : t.plural('pending.overrides.count', shown.items.length)}
          </StatusMessage>
          <StatusMessage tone={notice === 'removed' ? 'success' : 'info'}>
            {notice === undefined ? null : t(`pending.overrides.notice.${notice}`)}
          </StatusMessage>
        </>
      )}
      empty={
        <EmptyState
          level={3}
          title={t('pending.overrides.empty.title')}
          description={t('pending.overrides.empty.description')}
        />
      }
      rows={(page, focusHeading) => (
        <OverridesTable
          items={page.items}
          remove={{ installationId, repositoryId, suspended, onOutcome: setNotice, onVanished: focusHeading }}
        />
      )}
    />
  );
}
