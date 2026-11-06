// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { attachDocumentRoute } from '../../shared/repository-routes.ts';
import { type RepositoryChangeTarget, useRepositoryChange } from './use-repository-change.ts';

/**
 * The attach and the detach of a CLA document (E18-S10): `PUT /api/repositories/:repositoryId/cla-document` with `{ documentId }`, a
 * document to attach or `null` to detach, addressed through the repository of the row. The answer says what the repository enforces
 * now and whether the call changed it: a call that changed nothing is the outcome `unchanged`, not an error.
 */
export function useAttachDocument(input: RepositoryChangeTarget) {
  return useRepositoryChange({
    ...input,
    request: (client, repositoryId, documentId: number | null) =>
      client.call(attachDocumentRoute, { params: { repositoryId }, body: { documentId } }),
    outcomeOf: ({ changed, documentId }) => {
      if (!changed) {
        return 'unchanged';
      }
      return documentId === null ? 'detached' : 'attached';
    },
  });
}
