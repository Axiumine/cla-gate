// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { useInstallations } from '../installations/use-installations.ts';
import { usePageSubject } from '../layout/page-subject.ts';
import { LoadingState } from '../states/LoadingState.tsx';
import { Heading } from '../ui/Heading.tsx';
import { RepositoryFilters } from './RepositoryFilters.tsx';
import { RepositoryResults } from './RepositoryResults.tsx';
import { type Filters, filterKey } from './repository-filters.ts';

export interface RepositoriesPageProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  /** The search and the filter of the address. */
  readonly filters: Filters;
  /** `?cursor=` of the address: absent for the first page. */
  readonly cursor: string | undefined;
  /** Puts other filters in the address; the page starts again from the first. */
  readonly onFiltersChange: (filters: Filters) => void;
  readonly onCursorChange: (cursor: string | undefined) => void;
  /** Replaces the address with the first page. */
  readonly onFirstPage: () => void;
}

/**
 * The page at `/installations/$installationId/repositories` (E18-S10): the repositories of one tenant, with the CLA each one enforces,
 * where a maintainer attaches a document and turns the check on or off. It waits for the list of installations, because the
 * suspended flag and the role decide what is offered (the server decides on every request all the same). Every request is addressed through the
 * installation on screen or the repository of the row it came from. The results are made for the installation and the search in the
 * address, so another one starts from nothing.
 */
export function RepositoriesPage({
  installationId,
  filters,
  cursor,
  onFiltersChange,
  onCursorChange,
  onFirstPage,
}: RepositoriesPageProps) {
  const t = useT();
  const installations = useInstallations();
  const installation = installations.data?.find((candidate) => candidate.id === installationId);
  usePageSubject(installation?.accountLogin);
  if (installations.isPending) {
    return <LoadingState />;
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Heading level={1}>{t('repositories.title')}</Heading>
        <p className="max-w-prose text-fg-muted">{t('repositories.intro')}</p>
      </div>
      <RepositoryFilters filters={filters} onChange={onFiltersChange} />
      <RepositoryResults
        key={`${String(installationId)}:${filterKey(filters)}`}
        installationId={installationId}
        filters={filters}
        cursor={cursor}
        onCursorChange={onCursorChange}
        onFirstPage={onFirstPage}
        actions={{ installationId, role: installation?.role, suspended: installation?.suspended === true }}
      />
    </div>
  );
}
