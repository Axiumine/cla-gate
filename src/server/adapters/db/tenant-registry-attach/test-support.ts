// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { NoResultError } from 'kysely';
import { lockRepositoryForDocumentChange } from '../../../services/repository-document-lock-queries.ts';
import {
  findAttachableDocument,
  readRepositoryChangedAt,
  setRepositoryDocument,
} from '../../../services/repository-document-queries.ts';
import { ownersOfDocuments, ownersOfRepositories } from '../tenant-owners/test-support.ts';
import type { ScopedQuery } from '../tenant-registry/test-support.ts';

// The entries of the registry of the tenant data access (E11-S06) for the statements behind attaching a CLA document to a
// repository (E14-S02) and for turning enforcement on (E14-S03), kept in a file of their own so that the registry stays under the
// size cap. `TENANT_QUERIES` has them under `services/repository-document-lock-queries.ts` and
// `services/repository-document-queries.ts`. Each is called for a tenant with that tenant's ids and with another tenant's by the
// generated test of tenant-queries-matrix.test.ts. The world has the installation-wide document of each tenant (kind individual).

/** The locking read of a repository and the document it has. */
export const LOCK_QUERIES: Readonly<Record<string, ScopedQuery>> = {
  lockRepositoryForDocumentChange: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: true,
    run: async (db, scope, ids) => {
      const locked = await lockRepositoryForDocumentChange(db, scope, ids.plain.repositoryId);
      return locked === null ? [] : ownersOfRepositories(db, [locked.id]);
    },
  },
};

/** The statements that find the document to attach, write the pointer of a repository to it and read when a repository last changed (E14-S03). */
export const ATTACH_QUERIES: Readonly<Record<string, ScopedQuery>> = {
  findAttachableDocument: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: false,
    run: async (db, scope, ids) => {
      const document = await findAttachableDocument(db, scope, ids.plain.repositoryId, ids.documentId);
      return document === null ? [] : ownersOfDocuments(db, [document.id]);
    },
  },
  setRepositoryDocument: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: true,
    // A repository the tenant does not have is a row the statement finds none of, where the caller holds a lock: it throws.
    refusal: (error) => error instanceof NoResultError,
    run: async (db, scope, ids) => {
      await setRepositoryDocument(db, scope, ids.plain.repositoryId, ids.documentId);
      return ownersOfRepositories(db, [ids.plain.repositoryId]);
    },
  },
  readRepositoryChangedAt: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: true,
    // A repository the tenant does not have is a row the statement finds none of, where the caller holds a lock: it throws.
    refusal: (error) => error instanceof NoResultError,
    run: async (db, scope, ids) => {
      await readRepositoryChangedAt(db, scope, ids.plain.repositoryId);
      return ownersOfRepositories(db, [ids.plain.repositoryId]);
    },
  },
};
