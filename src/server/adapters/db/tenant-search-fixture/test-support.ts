// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { searchRows } from '../../../services/signature-search-queries.ts';
import {
  documentsOfRepositories,
  findRepositoryOfDocument,
  repositoriesWithSignedDocuments,
} from '../../../services/signature-search-scope-queries.ts';
import type { Database } from '../schema.ts';
import type { TenantWorld } from '../tenant-fixture/test-support.ts';
import { ownersOfDocuments, ownersOfRepositories, ownersOfSignatures } from '../tenant-owners/test-support.ts';
import type { ScopedQuery, TenantQuery } from '../tenant-registry/test-support.ts';
import { publishVersion, seedSignature, sha256 } from '../test-support.ts';

// The registry entries (E11-S06) of the statements the search for signatures runs over a tenant table (E15-S02): the signatures a
// maintainer looks up, and the repositories and documents the role of a repository admin is judged on. They sit in a file of their
// own so that the registry stays under the size cap, as the entries of the exports do (`tenant-export-fixture`).

/** The CLA text the signed repository documents of {@link signRepositoryDocuments} carry. */
const TERMS = 'terms of the repository document';

/** Gives the repository document of each tenant a version and one signature, which the seed leaves without both. */
async function signRepositoryDocuments(db: Kysely<Database>, tenants: readonly TenantWorld[]): Promise<void> {
  for (const tenant of tenants) {
    const version = await publishVersion(db, tenant.scoped.documentId, tenant.publisherId, {
      major: 1,
      minor: 0,
      text: TERMS,
    });
    await seedSignature(
      db,
      {
        ...tenant,
        documentId: tenant.scoped.documentId,
        versionId: version.id,
        contentSha256: sha256(TERMS),
        repositoryId: tenant.scoped.repositoryId,
      },
      tenant.signer.githubId + 1000,
    );
  }
}

/** A function that takes the tenant and the ids of a resource and answers with the rows of that tenant it read. */
const scoped = (options: Pick<ScopedQuery, 'run'> & Partial<ScopedQuery>): ScopedQuery => ({
  kind: 'scoped',
  takesIds: true,
  activeOnly: false,
  ...options,
});

/** Every function that the modules of the search export over a tenant table, by module and name. */
export const SEARCH_TENANT_QUERIES: Readonly<Record<string, Readonly<Record<string, TenantQuery>>>> = {
  // The seed gives each tenant one signature on its installation-wide document, so the search of that document finds the tenant's own
  // row with its own ids and nothing with another tenant's.
  'services/signature-search-queries.ts': {
    searchRows: scoped({
      run: async (db, scope, ids) => {
        const filter = { documentIds: [ids.documentId], state: 'all', githubUserId: null, login: null } as const;
        const rows = await searchRows(db, scope, filter, { limit: 10, from: null });
        return rows.length === 0
          ? []
          : ownersOfSignatures(
              db,
              rows.map((row) => row.id),
            );
      },
    }),
  },
  'services/signature-search-scope-queries.ts': {
    findRepositoryOfDocument: scoped({
      activeOnly: true,
      run: async (db, scope, ids) => {
        const repository = await findRepositoryOfDocument(db, scope, ids.scoped.documentId);
        return repository === undefined ? [] : ownersOfRepositories(db, [repository.id]);
      },
    }),
    // A list: it takes the scope and nothing else, and finds the repositories of the tenant whose document has a signature.
    repositoriesWithSignedDocuments: scoped({
      takesIds: false,
      activeOnly: true,
      arrange: signRepositoryDocuments,
      run: async (db, scope) => {
        const repositories = await repositoriesWithSignedDocuments(db, scope, 10);
        return repositories.length === 0
          ? []
          : ownersOfRepositories(
              db,
              repositories.map((repository) => repository.id),
            );
      },
    }),
    documentsOfRepositories: scoped({
      run: async (db, scope, ids) => {
        const documents = await documentsOfRepositories(db, scope, [ids.scoped.repositoryId]);
        return documents.length === 0 ? [] : ownersOfDocuments(db, documents);
      },
    }),
  },
};
