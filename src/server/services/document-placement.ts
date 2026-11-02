// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';

// Where a CLA document, or a signature made under one, sits in its tenant (E11-S07): the reads the resolvers of a document
// and of a signature use to decide the role a call needs. Every read names the installation.

/**
 * Where a CLA document sits, which decides the role a call about it needs (the role matrix of the security notes, E11-S07):
 * `installation` for a document that covers the whole installation, `repository` for one of a repository that is still part
 * of it, and `removed_repository` for one of a repository that left it (removed, uninstalled or transferred away). The
 * permission of a person on a repository that is no longer the installation's cannot be checked, so the last is a document
 * only an org admin reaches.
 */
export type DocumentPlacement =
  | { readonly kind: 'installation' }
  | { readonly kind: 'repository'; readonly repositoryId: number }
  | { readonly kind: 'removed_repository' };

/** What a read of a document and its repository answers: the repository the document is scoped to, and when it was removed. */
interface PlacementRow {
  readonly repository_id: number | null;
  readonly removed_at: Date | null;
}

function placementOf(row: PlacementRow | undefined): DocumentPlacement | null {
  if (row === undefined) {
    return null;
  }
  if (row.repository_id === null) {
    return { kind: 'installation' };
  }
  return row.removed_at === null
    ? { kind: 'repository', repositoryId: row.repository_id }
    : { kind: 'removed_repository' };
}

/**
 * Where the document `documentId` (`cla_documents.id`) of this tenant sits, or null when the tenant has no such document:
 * another tenant's document is read with the installation id too, so it is null here, as an unknown one is. The repository
 * is read in any state, because a removed repository keeps its documents (E05-S06).
 */
export async function findDocumentPlacement(
  db: Kysely<Database>,
  scope: TenantScope,
  documentId: number,
): Promise<DocumentPlacement | null> {
  const row = await db
    .selectFrom('cla_documents as d')
    .leftJoin('repositories as r', (join) =>
      join.onRef('r.id', '=', 'd.repository_id').onRef('r.installation_id', '=', 'd.installation_id'),
    )
    .select(['d.repository_id', 'r.removed_at'])
    .where('d.installation_id', '=', scope.installationId)
    .where('d.id', '=', documentId)
    .executeTakeFirst();
  return placementOf(row);
}

/**
 * Where the document of the signature `signatureId` (`signatures.id`) of this tenant sits: a signature belongs to the role
 * of its document, whatever repository it was made from. Null when the tenant has no such signature; a signature made under
 * another tenant's document, a transferred repository's included, is read with the installation id and is null here.
 */
export async function findSignaturePlacement(
  db: Kysely<Database>,
  scope: TenantScope,
  signatureId: number,
): Promise<DocumentPlacement | null> {
  const row = await db
    .selectFrom('signatures as s')
    .innerJoin('cla_documents as d', (join) =>
      join.onRef('d.id', '=', 's.document_id').onRef('d.installation_id', '=', 's.installation_id'),
    )
    .leftJoin('repositories as r', (join) =>
      join.onRef('r.id', '=', 'd.repository_id').onRef('r.installation_id', '=', 'd.installation_id'),
    )
    .select(['d.repository_id', 'r.removed_at'])
    .where('s.installation_id', '=', scope.installationId)
    .where('s.id', '=', signatureId)
    .executeTakeFirst();
  return placementOf(row);
}
