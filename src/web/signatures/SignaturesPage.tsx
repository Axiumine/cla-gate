// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { useInstallations } from '../installations/use-installations.ts';
import { usePageSubject } from '../layout/page-subject.ts';
import { LoadingState } from '../states/LoadingState.tsx';
import { Heading } from '../ui/Heading.tsx';
import { ExportCsv } from './ExportCsv.tsx';
import { SignatureFilters } from './SignatureFilters.tsx';
import { SignatureResults } from './SignatureResults.tsx';
import { type Filters, filterKey } from './signature-filters.ts';
import { canErase, canManage } from './signature-permissions.ts';
import { useDocumentChoices } from './use-document-choices.ts';

export interface SignaturesPageProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  /** The search, status and document of the address. */
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
 * The page at `/installations/$installationId/signatures` (E18-S07): the signatures of one tenant a maintainer looks up, with the exact search,
 * the status and document filters, the revocation, the CSV export and, for an org admin, the erasure of a signer's personal data (E18-S14). It waits for the list of installations, because the role decides
 * what is offered: an org admin may revoke and export every document, a repo admin the documents of their repositories, and a role that is
 * not known gets neither (the server decides on every request all the same). Every request is addressed through the installation on screen.
 * The results are made for the installation and the search in the address, so another one starts from nothing.
 */
export function SignaturesPage({
  installationId,
  filters,
  cursor,
  onFiltersChange,
  onCursorChange,
  onFirstPage,
}: SignaturesPageProps) {
  const t = useT();
  const installations = useInstallations();
  const installation = installations.data?.find((candidate) => candidate.id === installationId);
  usePageSubject(installation?.accountLogin);
  const role = installation?.role;
  const suspended = installation?.suspended === true;
  const documents = useDocumentChoices(installationId, role);
  if (installations.isPending) {
    return <LoadingState />;
  }
  const scopes = new Map(documents.map((document) => [document.id, document.scope]));
  const allowed = (documentId: number) => canManage(role, scopes.get(documentId));
  const exportable = canManage(role, filters.document === undefined ? undefined : scopes.get(filters.document));
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Heading level={1}>{t('signatures.title')}</Heading>
        <p className="max-w-prose text-fg-muted">{t('signatures.intro')}</p>
      </div>
      <SignatureFilters filters={filters} documents={documents} onChange={onFiltersChange} />
      {exportable ? (
        <ExportCsv installationId={installationId} documentId={filters.document} state={filters.state} />
      ) : null}
      <SignatureResults
        key={`${String(installationId)}:${filterKey(filters)}`}
        installationId={installationId}
        filters={filters}
        cursor={cursor}
        onCursorChange={onCursorChange}
        onFirstPage={onFirstPage}
        revoke={{ installationId, suspended, allowed }}
        erase={canErase(role) ? { installationId, suspended } : undefined}
      />
    </div>
  );
}
