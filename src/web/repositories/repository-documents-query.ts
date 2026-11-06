// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { queryOptions } from '@tanstack/react-query';
import type { SuccessOf } from '../../shared/contract.ts';
import { repositoryDocumentsRoute } from '../../shared/repository-routes.ts';
import type { ApiClient } from '../api/index.ts';
import { installationKey } from '../installations/installation-queries.ts';

// The query of the documents a repository may enforce, for the attach dialog of the Repositories screen (E18-S10). Its key starts with
// `['installation', installationId]` (E18-S04), like every query of a tenant.

/** The documents a repository may enforce, as the attach dialog gets them. */
export type RepositoryDocuments = SuccessOf<typeof repositoryDocumentsRoute>;

/**
 * `GET /api/installations/:installationId/repositories/:repositoryId/documents` (E12-S01): the repository's own documents and the
 * installation-wide ones that cover it, never their text. Asked for when the attach dialog opens and dropped when it closes
 * (`gcTime: 0`), so the choices are those of the moment; the key holds the installation and the repository the row came from.
 */
export function repositoryDocumentsQueryOptions(client: ApiClient, installationId: number, repositoryId: number) {
  return queryOptions({
    queryKey: [...installationKey(installationId), 'repository-documents', repositoryId] as const,
    queryFn: ({ signal }) =>
      client.call(repositoryDocumentsRoute, { params: { installationId, repositoryId } }, { signal }),
    staleTime: 0,
    gcTime: 0,
  });
}
