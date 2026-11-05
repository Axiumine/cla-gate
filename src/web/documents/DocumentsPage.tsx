// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../auth/hooks.ts';
import { useT } from '../i18n/index.ts';
import { useInstallation } from '../installations/use-installations.ts';
import { usePageSubject } from '../layout/page-subject.ts';
import { EmptyState } from '../states/EmptyState.tsx';
import { QueryBoundary } from '../states/QueryBoundary.tsx';
import { Heading } from '../ui/Heading.tsx';
import { DocumentsTable } from './DocumentsTable.tsx';
import { documentsQueryOptions } from './document-queries.ts';
import { NewDocumentDialog } from './NewDocumentDialog.tsx';

export interface DocumentsPageProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
}

/**
 * The page at `/installations/$installationId/documents` (E18-S05): the CLA documents of one tenant, with the button that makes a
 * new one. Everything on it is shown after the server has answered for this installation; a role that may not list the documents
 * (a repo admin, who reaches the documents of a repository from the repository screen) gets the server's `403` as the forbidden
 * state, with no document. The button is off while the installation is suspended (the banner above says why).
 */
export function DocumentsPage({ installationId }: DocumentsPageProps) {
  const t = useT();
  const installation = useInstallation(installationId);
  usePageSubject(installation?.accountLogin);
  const query = useQuery(documentsQueryOptions(useApiClient(), installationId));
  return (
    <QueryBoundary query={query} errorLevel={1}>
      {({ documents }) => (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <Heading level={1}>{t('documents.title')}</Heading>
              <p className="max-w-prose text-fg-muted">{t('documents.intro')}</p>
            </div>
            <NewDocumentDialog installationId={installationId} suspended={installation?.suspended === true} />
          </div>
          {documents.length === 0 ? (
            <EmptyState level={2} title={t('documents.empty.title')} description={t('documents.empty.description')} />
          ) : (
            <DocumentsTable installationId={installationId} documents={documents} />
          )}
        </div>
      )}
    </QueryBoundary>
  );
}
