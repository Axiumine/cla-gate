// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { findDocument, listDocuments, listRepositoryDocuments } from '../../../services/cla-document-queries.ts';
import { countDocuments, insertDocument, updateDocumentName } from '../../../services/cla-document-writes.ts';
import type { Database } from '../schema.ts';
import { ownersOfDocuments } from '../tenant-owners/test-support.ts';
import type { ScopedQuery } from '../tenant-registry/test-support.ts';

// The entries of the registry of the tenant data access (E11-S06) for the statements over the CLA documents (E12-S01), kept in a
// file of their own so that the registry stays under the size cap. `TENANT_QUERIES` has the reads under
// `services/cla-document-queries.ts` and the writes under `services/cla-document-writes.ts`. Every statement is called for a tenant
// with that tenant's ids and with another tenant's, by the generated test of tenant-queries-matrix.test.ts.

const RENAMED = 'renamed/by-test';

/** The installation that owns each document of the database, in any tenant. */
async function ownersOfAllDocuments(db: Kysely<Database>): Promise<number[]> {
  const rows = await db.selectFrom('cla_documents').select('installation_id').execute();
  return rows.map((row) => row.installation_id);
}

/** The reads of `cla_documents`. */
export const DOCUMENT_READS: Readonly<Record<string, ScopedQuery>> = {
  findDocument: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: false,
    run: async (db, scope, ids) => {
      const document = await findDocument(db, scope, ids.documentId);
      return document === null ? [] : ownersOfDocuments(db, [document.id]);
    },
  },
  listDocuments: {
    kind: 'scoped',
    takesIds: false,
    activeOnly: false,
    run: async (db, scope) => {
      const documents = await listDocuments(db, scope, { limit: 100, from: null });
      // Id 0 names no document: the query stays valid for a tenant that has none.
      return ownersOfDocuments(db, [0, ...documents.map((document) => document.id)]);
    },
  },
  listRepositoryDocuments: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: true,
    run: async (db, scope, ids) => {
      const documents = await listRepositoryDocuments(db, scope, ids.scoped.repositoryId);
      const shown = [...(documents?.repositoryScoped ?? []), ...(documents?.installationScoped ?? [])];
      return shown.length === 0
        ? []
        : ownersOfDocuments(
            db,
            shown.map((document) => document.id),
          );
    },
  },
};

/** The writes of `cla_documents`. */
export const DOCUMENT_WRITES: Readonly<Record<string, ScopedQuery>> = {
  countDocuments: {
    kind: 'scoped',
    // The count belongs to the tenant it is asked for; there is no document of another tenant to name.
    takesIds: false,
    activeOnly: false,
    run: async (db, scope) => {
      const counted = await countDocuments(db, scope);
      const owned = await ownersOfAllDocuments(db);
      // A count that strayed into another tenant is more than the rows that tenant owns: the surplus moves the id to one that is another tenant's.
      return [scope.installationId + counted - owned.filter((owner) => owner === scope.installationId).length];
    },
  },
  insertDocument: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: true,
    run: async (db, scope, ids) => {
      const document = await insertDocument(db, scope, {
        name: 'Registry document',
        kind: 'individual',
        repositoryId: ids.plain.repositoryId,
      });
      return document === null ? [] : ownersOfDocuments(db, [document.id]);
    },
  },
  updateDocumentName: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: false,
    run: async (db, scope, ids) => {
      const document = await updateDocumentName(db, scope, ids.scoped.documentId, RENAMED);
      return document === null ? [] : ownersOfDocuments(db, [document.id]);
    },
  },
};
