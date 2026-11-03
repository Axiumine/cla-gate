// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { findDocument, listDocuments, listRepositoryDocuments } from './cla-document-queries.ts';
import type { DocumentPosition, RepositoryDocuments, StoredDocument } from './cla-document-types.ts';
import { findDraftRevision } from './cla-draft-queries.ts';
import { ClaRuleError } from './cla-rule-error.ts';

// What can be read of the CLA documents of a tenant (E12-S01): one document, a page of them, and those of a repository.
// Creating and renaming are in cla-document-changes.ts. A rule a request can break is a `ClaRuleError` (cla-rule-error.ts).

/** A document with the one fact only the detail view tells: whether work in progress is saved for it. */
export interface DocumentDetail extends StoredDocument {
  readonly hasDraft: boolean;
}

/**
 * The document `documentId` of the tenant with its active version. `hasDraft` says whether a draft is saved for it (E12-S03);
 * the text of the draft is not read.
 * @throws ClaRuleError `not_found` when the tenant has no such document.
 */
export async function readDocument(
  db: Kysely<Database>,
  scope: TenantScope,
  documentId: number,
): Promise<DocumentDetail> {
  const [document, draftRevision] = await Promise.all([
    findDocument(db, scope, documentId),
    findDraftRevision(db, scope, documentId),
  ]);
  if (document === null) {
    throw new ClaRuleError('not_found');
  }
  return { ...document, hasDraft: draftRevision !== null };
}

/** One page of the documents of a tenant: the rows, and where the next page starts (null on the last page). */
export interface DocumentPage {
  readonly documents: readonly StoredDocument[];
  readonly next: DocumentPosition | null;
}

/**
 * A page of the documents of the tenant in the order `name asc, id asc`: `limit` rows from `from` (inclusive). One row more
 * than the page is read: it tells whether more follow, and it is where the next page starts.
 */
export async function listDocumentPage(
  db: Kysely<Database>,
  scope: TenantScope,
  page: { readonly limit: number; readonly from: DocumentPosition | null },
): Promise<DocumentPage> {
  const rows = await listDocuments(db, scope, { limit: page.limit + 1, from: page.from });
  const following = rows[page.limit];
  return {
    documents: rows.slice(0, page.limit),
    next: following === undefined ? null : { name: following.name, id: following.id },
  };
}

/**
 * The documents a repository admin sees for the repository: its own and the installation-wide ones.
 * @throws ClaRuleError `not_found` when the repository is not an active one of the tenant.
 */
export async function readRepositoryDocuments(
  db: Kysely<Database>,
  scope: TenantScope,
  repositoryId: number,
): Promise<RepositoryDocuments> {
  const documents = await listRepositoryDocuments(db, scope, repositoryId);
  if (documents === null) {
    throw new ClaRuleError('not_found');
  }
  return documents;
}
