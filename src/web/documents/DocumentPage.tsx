// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../auth/hooks.ts';
import { useInstallation } from '../installations/use-installations.ts';
import { usePageSubject } from '../layout/page-subject.ts';
import { QueryBoundary } from '../states/QueryBoundary.tsx';
import { DocumentEditor } from './DocumentEditor.tsx';
import { type DocumentIds, editorSeedQueryOptions } from './document-queries.ts';
import type { DocumentSearch, OnSearch } from './history/history-search.ts';

export interface DocumentPageProps extends DocumentIds {
  /** What the address holds, once validated. */
  readonly search: DocumentSearch;
  /** Changes the address. */
  readonly onSearch: OnSearch;
}

/**
 * The page at `/installations/$installationId/documents/$documentId` (E18-S05): one document, with its editor. The editor opens
 * once the server has answered for this document (the document, its saved draft and the text of its active version); a document
 * the person may not open, one that does not exist and one of another tenant are the server's `403` and uniform `404`, shown as
 * that state with nothing of the document. The role that may open it follows the scope of the document: an org admin for an
 * installation-wide one, an admin of the repository for one of a repository.
 */
export function DocumentPage({ installationId, documentId, search, onSearch }: DocumentPageProps) {
  usePageSubject(useInstallation(installationId)?.accountLogin);
  const query = useQuery(editorSeedQueryOptions(useApiClient(), { installationId, documentId }));
  return (
    <QueryBoundary query={query} errorLevel={1}>
      {(seed) => (
        <DocumentEditor ids={{ installationId, documentId }} seed={seed} search={search} onSearch={onSearch} />
      )}
    </QueryBoundary>
  );
}
