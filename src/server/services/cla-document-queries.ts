// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { toDocument } from './cla-document-rows.ts';
import type { DocumentPosition, RepositoryDocuments, StoredDocument } from './cla-document-types.ts';

// The statements that read the CLA documents of a tenant (E12-S01). Every one names the installation in its WHERE clause, so
// a document id of another tenant finds nothing; the documents of a repository are read only for a repository that is
// still part of the tenant. The statements that write them are in cla-document-writes.ts; the rules (names, limits, audit)
// are in cla-documents.ts and cla-document-changes.ts.

/** The documents of the tenant in the order `name asc, id asc`, with their active version: the version is joined on both keys, so it is the document's own. */
function selectDocuments(db: Kysely<Database>, scope: TenantScope) {
  return db
    .selectFrom('cla_documents as d')
    .leftJoin('cla_versions as v', (join) =>
      join.onRef('v.id', '=', 'd.active_version_id').onRef('v.document_id', '=', 'd.id'),
    )
    .selectAll('d')
    .select(['v.id as version_id', 'v.major', 'v.minor', 'v.content_sha256', 'v.published_at'])
    .where('d.installation_id', '=', scope.installationId)
    .orderBy('d.name')
    .orderBy('d.id');
}

/** The document `documentId` (`cla_documents.id`) of the tenant, or null when the tenant has no such document. */
export async function findDocument(
  db: Kysely<Database>,
  scope: TenantScope,
  documentId: number,
): Promise<StoredDocument | null> {
  const row = await selectDocuments(db, scope).where('d.id', '=', documentId).executeTakeFirst();
  return row === undefined ? null : toDocument(row);
}

/**
 * Up to `page.limit` documents of the tenant in the order `name asc, id asc`, starting at `page.from` (that document
 * included) when it is given. The position is compared as the pair (name, id) in that order, so no document is skipped or
 * repeated between pages.
 */
export async function listDocuments(
  db: Kysely<Database>,
  scope: TenantScope,
  page: { readonly limit: number; readonly from: DocumentPosition | null },
): Promise<StoredDocument[]> {
  const { from } = page;
  const all = selectDocuments(db, scope);
  const rows = await (from === null ? all : all.where(sql<boolean>`(d.name, d.id) >= (${from.name}, ${from.id})`))
    .limit(page.limit)
    .execute();
  return rows.map(toDocument);
}

/**
 * The documents a repository admin sees for the repository `repositoryId` (`repositories.id`): those scoped to the repository
 * and those that cover the whole installation. Null when the repository is not an active one of the tenant.
 */
export async function listRepositoryDocuments(
  db: Kysely<Database>,
  scope: TenantScope,
  repositoryId: number,
): Promise<RepositoryDocuments | null> {
  const repository = await db
    .selectFrom('repositories')
    .select('id')
    .where('installation_id', '=', scope.installationId)
    .where('id', '=', repositoryId)
    .where('removed_at', 'is', null)
    .executeTakeFirst();
  if (repository === undefined) {
    return null;
  }
  const [repositoryScoped, installationScoped] = await Promise.all([
    selectDocuments(db, scope).where('d.repository_id', '=', repositoryId).execute(),
    selectDocuments(db, scope).where('d.repository_id', 'is', null).execute(),
  ]);
  return { repositoryScoped: repositoryScoped.map(toDocument), installationScoped: installationScoped.map(toDocument) };
}
