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
