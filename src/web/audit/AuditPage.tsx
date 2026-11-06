// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { useInstallation } from '../installations/use-installations.ts';
import { usePageSubject } from '../layout/page-subject.ts';
import { Heading } from '../ui/index.ts';
import { AuditFilterForm } from './AuditFilterForm.tsx';
import { AuditResults } from './AuditResults.tsx';
import { type AuditFilters, filterKey } from './audit-filters.ts';

export interface AuditPageProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  /** The filters of the address. */
  readonly filters: AuditFilters;
  /** `?cursor=` of the address: absent for the first page. */
  readonly cursor: string | undefined;
  /** Puts other filters in the address; the page starts again from the first. */
  readonly onFiltersChange: (filters: AuditFilters) => void;
  readonly onCursorChange: (cursor: string | undefined) => void;
  /** Replaces the address with the first page. */
  readonly onFirstPage: () => void;
}

/**
 * The page at `/installations/$installationId/audit` (E18-S09): the audit trail of one tenant, read-only. It has no control that
 * changes anything: the filters, the pager and the button that opens a row's metadata are all there is. Only an org admin may read the
 * log, and the server decides on every request (a `403` and the uniform `404` replace the table with that state and no row), so the
 * page does not wait for the list of installations; it only borrows the account's name for the title. The form and the results are
 * made for the installation and the filters in the address, so another set starts from nothing.
 */
export function AuditPage({
  installationId,
  filters,
  cursor,
  onFiltersChange,
  onCursorChange,
  onFirstPage,
}: AuditPageProps) {
  const t = useT();
  usePageSubject(useInstallation(installationId)?.accountLogin);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Heading level={1}>{t('audit.title')}</Heading>
        <p className="max-w-prose text-fg-muted">{t('audit.intro')}</p>
      </div>
      <AuditFilterForm key={filterKey(filters)} filters={filters} onApply={onFiltersChange} />
      <AuditResults
        key={`${String(installationId)}:${filterKey(filters)}`}
        installationId={installationId}
        filters={filters}
        cursor={cursor}
        onCursorChange={onCursorChange}
        onFirstPage={onFirstPage}
      />
    </div>
  );
}
