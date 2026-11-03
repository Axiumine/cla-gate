// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { ClaDocumentKind } from '../../shared/cla.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { findDocument } from './cla-document-queries.ts';
import type { StoredDocument } from './cla-document-types.ts';

// The statements that write the CLA documents of a tenant (E12-S01), and the count the limit is checked with. Every one names
// the installation in its WHERE clause or its values. The statements that read them are in cla-document-queries.ts.

/**
 * How many documents the tenant holds, those of removed repositories included (they stay with the tenant). The caller holds
 * the creation lock of the tenant, so the number stays true until its transaction ends.
 */
export async function countDocuments(db: Kysely<Database>, scope: TenantScope): Promise<number> {
  const row = await db
    .selectFrom('cla_documents')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('installation_id', '=', scope.installationId)
    .executeTakeFirstOrThrow();
  return row.n;
}

/**
 * Stores a new document for the tenant. A repository-scoped one is stored only when the repository belongs to the tenant
 * and is not removed: the repository row is read with the installation id and held with a share lock until the caller's
 * transaction ends, so the sync cannot remove it between the check and the insert. The unique constraint on
 * (installation, repository, name) decides a duplicate: the database error is the caller's to read.
 * @returns the stored document, or null when the repository is another tenant's, unknown or removed.
 */
export async function insertDocument(
  db: Kysely<Database>,
  scope: TenantScope,
  input: { readonly name: string; readonly kind: ClaDocumentKind; readonly repositoryId: number | null },
): Promise<StoredDocument | null> {
  if (input.repositoryId !== null) {
    const repository = await db
      .selectFrom('repositories')
      .select('id')
      .where('installation_id', '=', scope.installationId)
      .where('id', '=', input.repositoryId)
      .where('removed_at', 'is', null)
      .forShare()
      .executeTakeFirst();
    if (repository === undefined) {
      return null;
    }
  }
  const { id } = await db
    .insertInto('cla_documents')
    .values({
      installation_id: scope.installationId,
      repository_id: input.repositoryId,
      name: input.name,
      kind: input.kind,
      active_version_id: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return findDocument(db, scope, id);
}

/**
 * Gives the document `documentId` of the tenant the name `name` and moves `updated_at` forward. The unique constraint
 * decides a duplicate, as for {@link insertDocument}.
 * @returns the document as it is now, or null when the tenant has no such document.
 */
export async function updateDocumentName(
  db: Kysely<Database>,
  scope: TenantScope,
  documentId: number,
  name: string,
): Promise<StoredDocument | null> {
  const updated = await db
    .updateTable('cla_documents')
    .set({ name, updated_at: sql`now()` })
    .where('installation_id', '=', scope.installationId)
    .where('id', '=', documentId)
    .returning('id')
    .executeTakeFirst();
  return updated === undefined ? null : findDocument(db, scope, updated.id);
}
