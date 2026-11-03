// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';

// The statements behind attaching a CLA document to a repository and detaching it (E14-S02), besides the lock of the repository
// (repository-document-lock-queries.ts): the document to attach, and the write of the pointer. Every one names the installation
// in its WHERE clause, so a repository or a document of another tenant finds nothing; the composite foreign key
// `(cla_document_id, installation_id)` of migration 001 is the second line behind that. The rules, the audit row and the job are in
// repository-document-attach.ts.

/** A document the repository may enforce, as far as attaching it needs to know. */
export interface AttachableDocument {
  readonly id: number;
  /** The repository the document is scoped to, null for one that covers the installation. */
  readonly repositoryId: number | null;
  /** The version the document points at; null until its first publish. */
  readonly activeVersionId: number | null;
}

/**
 * The document `documentId` when the repository `repositoryId` of the tenant may enforce it: it belongs to the tenant, it is of
 * the individual kind (a corporate one comes with E21), and it covers the whole installation or is scoped to this very
 * repository. Null for everything else, which the caller answers alike: no document, another tenant's, another repository's
 * and a corporate one cannot be told apart.
 */
export async function findAttachableDocument(
  db: Kysely<Database>,
  scope: TenantScope,
  repositoryId: number,
  documentId: number,
): Promise<AttachableDocument | null> {
  const row = await db
    .selectFrom('cla_documents')
    .select(['id', 'repository_id', 'active_version_id'])
    .where('installation_id', '=', scope.installationId)
    .where('id', '=', documentId)
    .where('kind', '=', 'individual')
    .where((condition) =>
      condition.or([condition('repository_id', 'is', null), condition('repository_id', '=', repositoryId)]),
    )
    .executeTakeFirst();
  return row === undefined
    ? null
    : { id: row.id, repositoryId: row.repository_id, activeVersionId: row.active_version_id };
}

/**
 * Points the repository `repositoryId` of the tenant at the document `documentId`, or at none (null), and touches its
 * `updated_at`. The composite foreign key refuses a document of another installation.
 * @returns the time of the change, which names it.
 * @throws NoResultError when the tenant has no such repository (the caller holds its lock, so it does not happen).
 */
export async function setRepositoryDocument(
  db: Kysely<Database>,
  scope: TenantScope,
  repositoryId: number,
  documentId: number | null,
): Promise<Date> {
  const row = await db
    .updateTable('repositories')
    .set({ cla_document_id: documentId, updated_at: sql`now()` })
    .where('installation_id', '=', scope.installationId)
    .where('id', '=', repositoryId)
    .where('removed_at', 'is', null)
    .returning('updated_at')
    .executeTakeFirstOrThrow();
  return row.updated_at;
}
