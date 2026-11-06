// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { InstallationRole } from '../../shared/installations.ts';
import type { PendingReasonCode } from '../../shared/pending-prs.ts';
import { useT } from '../i18n/index.ts';
import { PendingResults } from './PendingResults.tsx';
import { ReasonField } from './ReasonField.tsx';
import { RepositoryField } from './RepositoryField.tsx';
import { useRepositoryChoices } from './use-repository-choices.ts';

/** What the pending list is narrowed to. */
export interface PendingFilters {
  readonly repository: number | undefined;
  readonly reason: PendingReasonCode | undefined;
}

export interface PendingTabProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  /** The role of the person in this installation, when the list of installations has it: a repo admin chooses among their repositories. */
  readonly role: InstallationRole | undefined;
  readonly suspended: boolean;
  readonly filters: PendingFilters;
  /** `?cursor=` of the address: absent for the first page. */
  readonly cursor: string | undefined;
  /** Puts other filters in the address; the page starts again from the first. */
  readonly onFiltersChange: (filters: PendingFilters) => void;
  readonly onCursorChange: (cursor: string | undefined) => void;
  readonly onFirstPage: () => void;
}

/**
 * The first tab (E18-S08): what to do about a blocked pull request (the help text), the repository and reason filters, and the list.
 * The help says that there is no button to check a pull request again: it is checked after a signature, an override or an allowlist
 * change, and anyone can comment `/recheck`. The list is made for the installation and the filters in the address, so another set
 * starts from nothing.
 */
export function PendingTab({
  installationId,
  role,
  suspended,
  filters,
  cursor,
  onFiltersChange,
  onCursorChange,
  onFirstPage,
}: PendingTabProps) {
  const t = useT();
  const choices = useRepositoryChoices(installationId, role);
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-fg-muted">{t('pending.help')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <RepositoryField
          choices={choices}
          value={filters.repository}
          label={t('pending.filter.repository')}
          none={t('pending.filter.repository.all')}
          byId={(id) => t('pending.repository.byId', { id })}
          onChange={(repository) => {
            onFiltersChange({ ...filters, repository });
          }}
        />
        <ReasonField
          value={filters.reason}
          onChange={(reason) => {
            onFiltersChange({ ...filters, reason });
          }}
        />
      </div>
      <PendingResults
        key={`${String(installationId)}:${String(filters.repository)}:${String(filters.reason)}`}
        installationId={installationId}
        filters={filters}
        cursor={cursor}
        onCursorChange={onCursorChange}
        onFirstPage={onFirstPage}
        suspended={suspended}
      />
    </div>
  );
}
