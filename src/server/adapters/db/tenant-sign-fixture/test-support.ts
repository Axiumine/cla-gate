// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { findSignDocument, findSignRepository, listViewerSignatures } from '../../../services/sign-context-queries.ts';
import { ownersOfDocuments, ownersOfSignatures } from '../tenant-owners/test-support.ts';
import type { ScopedQuery, TenantQuery } from '../tenant-registry/test-support.ts';

// The registry entries (E11-S06) of the statements the sign page context runs over the tenant tables (E13-S02). The seed gives
// each tenant a document with its version 1.0 and one signature of its own signer on it, so a statement that strays into the
// other tenant has a row to meet. They sit in a file of their own so that the registry stays under the size cap, as the
// entries of the exports do (`tenant-export-fixture`).

/** A function that takes the tenant and the ids of a resource and answers with the rows of that tenant it read. */
const scoped = (options: Pick<ScopedQuery, 'run'>): ScopedQuery => ({
  kind: 'scoped',
  takesIds: true,
  activeOnly: false,
  ...options,
});

/** Every function of the sign context statements, by module and name. */
export const SIGN_TENANT_QUERIES: Readonly<Record<string, Readonly<Record<string, TenantQuery>>>> = {
  'services/sign-context-queries.ts': {
    findSignRepository: {
      kind: 'by_design',
      reason:
        "the sign link names a repository by GitHub's id and nothing else (E13-S02), so the tenant is found from it: the statement reads the one active repository under that id with the state of its installation and answers no list; the caller turns a tenant that is not served into the same 404 as an unknown repository",
      pinnedBy: 'services/sign-context-queries.test.ts',
      run: async (db, _scope, ids) => (await findSignRepository(db, ids.plain.githubRepoId))?.installationId,
      answers: (own, other) => ({ own: own.installationId, foreign: other.installationId }),
    },
    findSignDocument: scoped({
      run: async (db, scope, ids) => {
        const document = await findSignDocument(db, scope, ids.documentId);
        return document === null ? [] : ownersOfDocuments(db, [document.id]);
      },
    }),
    listViewerSignatures: scoped({
      run: async (db, scope, ids) => {
        const signatures = await listViewerSignatures(db, scope, ids.signer.userId, ids.documentId);
        return signatures.length === 0
          ? []
          : ownersOfSignatures(
              db,
              signatures.map((signature) => signature.id),
            );
      },
    }),
  },
};
