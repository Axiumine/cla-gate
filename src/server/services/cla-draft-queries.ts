// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';

// The reads of the drafts of the CLA documents of a tenant (E12-S03); the writes are in cla-draft-writes.ts. Every statement
// names the installation in its WHERE clause next to the document id, so another tenant's document finds nothing. The rules
// (the text, the revision, the audit row) are in cla-drafts.ts. Nothing here touches `cla_documents`: a draft never changes
// the active version.

/** A saved draft: the canonical text, the revision it is at and when it was saved. */
export interface StoredDraft {
  readonly contentMd: string;
  readonly revision: number;
  readonly updatedAt: Date;
}

/** The draft of the document `documentId` of the tenant, or null when none is saved or the tenant has no such document. */
export async function findDraft(
  db: Kysely<Database>,
  scope: TenantScope,
  documentId: number,
): Promise<StoredDraft | null> {
  const row = await db
    .selectFrom('cla_drafts')
    .select(['content_md', 'revision', 'updated_at'])
    .where('installation_id', '=', scope.installationId)
    .where('document_id', '=', documentId)
    .executeTakeFirst();
  return row === undefined ? null : { contentMd: row.content_md, revision: row.revision, updatedAt: row.updated_at };
}

/**
 * The draft of the document `documentId` of the tenant, locked until the end of the caller's transaction (`select ... for
 * update`), or null when none is saved. Publishing a version (E12-S04) reads the draft this way: a save that arrives meanwhile
 * waits, and when the publish has committed it finds no draft at its revision, so a text that was published is never
 * overwritten by one nobody published.
 */
export async function lockDraft(
  db: Kysely<Database>,
  scope: TenantScope,
  documentId: number,
): Promise<StoredDraft | null> {
  const row = await db
    .selectFrom('cla_drafts')
    .select(['content_md', 'revision', 'updated_at'])
    .where('installation_id', '=', scope.installationId)
    .where('document_id', '=', documentId)
    .forUpdate()
    .executeTakeFirst();
  return row === undefined ? null : { contentMd: row.content_md, revision: row.revision, updatedAt: row.updated_at };
}

/** The revision of the draft of the document, or null when none is saved. The text is not read: the check needs the number only. */
export async function findDraftRevision(
  db: Kysely<Database>,
  scope: TenantScope,
  documentId: number,
): Promise<number | null> {
  const row = await db
    .selectFrom('cla_drafts')
    .select('revision')
    .where('installation_id', '=', scope.installationId)
    .where('document_id', '=', documentId)
    .executeTakeFirst();
  return row?.revision ?? null;
}

/**
 * The ids, among `documentIds`, of the documents of the tenant that have a draft saved: what the list of documents shows as "Draft saved"
 * (E18-S05). Only the ids are read, never a text, and a document of another tenant is never in the answer.
 */
export async function findDraftedDocumentIds(
  db: Kysely<Database>,
  scope: TenantScope,
  documentIds: readonly number[],
): Promise<ReadonlySet<number>> {
  if (documentIds.length === 0) {
    return new Set();
  }
  const rows = await db
    .selectFrom('cla_drafts')
    .select('document_id')
    .where('installation_id', '=', scope.installationId)
    .where('document_id', 'in', documentIds)
    .execute();
  return new Set(rows.map((row) => row.document_id));
}
