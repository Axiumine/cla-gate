// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';

// The writes over the drafts of the CLA documents of a tenant (E12-S03); the reads are in cla-draft-queries.ts. Every
// statement names the installation in its WHERE clause or its values, next to the document id, so another tenant's document
// finds nothing and a draft can only be written under the installation that owns its document (the composite foreign key of
// migration 009 says the same). The rules (the text, the revision, the audit row) are in cla-drafts.ts. Nothing here touches
// `cla_documents`: a draft never changes the active version.

/** What a save leaves: the revision the draft is at now and when it was saved. The text is not read back. */
export interface SavedDraft {
  readonly revision: number;
  readonly updatedAt: Date;
}

/** Who saves, and what: the text is canonical already (`prepareClaText`), the person is `users.id`. */
export interface DraftWrite {
  readonly contentMd: string;
  readonly updatedBy: number;
}

/** A row of `returning revision, updated_at` as the {@link SavedDraft} the callers read; null when the statement changed no row. */
const savedOf = (row: { readonly revision: number; readonly updated_at: Date } | undefined): SavedDraft | null =>
  row === undefined ? null : { revision: row.revision, updatedAt: row.updated_at };

/**
 * Stores the first draft of the document at revision 1. When a draft exists already, nothing is written, and that is the
 * answer: the database decides two creators that race, the one that waits for the other's row finds it and does nothing.
 * The document must belong to the tenant: the composite foreign key refuses any other pairing, and the caller has read
 * the document with the installation id first.
 * @returns the draft as stored, or null when the document already has one.
 */
export async function insertDraft(
  db: Kysely<Database>,
  scope: TenantScope,
  documentId: number,
  write: DraftWrite,
): Promise<SavedDraft | null> {
  const row = await db
    .insertInto('cla_drafts')
    .values({
      document_id: documentId,
      installation_id: scope.installationId,
      content_md: write.contentMd,
      updated_by: write.updatedBy,
    })
    .onConflict((conflict) => conflict.column('document_id').doNothing())
    .returning(['revision', 'updated_at'])
    .executeTakeFirst();
  return savedOf(row);
}

/**
 * Saves a new text over the draft in one statement guarded by the revision the editor read: the row changes only while it
 * is still at `expectedRevision`, and the revision goes up by one. A second save with the same expected revision waits for
 * the first row lock, finds the revision moved and changes nothing.
 * @returns the draft as it is now, or null when the document has no draft at that revision.
 */
export async function updateDraft(
  db: Kysely<Database>,
  scope: TenantScope,
  documentId: number,
  write: DraftWrite & { readonly expectedRevision: number },
): Promise<SavedDraft | null> {
  const row = await db
    .updateTable('cla_drafts')
    .set({
      content_md: write.contentMd,
      revision: sql<number>`revision + 1`,
      updated_by: write.updatedBy,
      updated_at: sql`now()`,
    })
    .where('installation_id', '=', scope.installationId)
    .where('document_id', '=', documentId)
    .where('revision', '=', write.expectedRevision)
    .returning(['revision', 'updated_at'])
    .executeTakeFirst();
  return savedOf(row);
}

/** Removes the draft of the document. @returns the revision the draft was at, or null when there was none. */
export async function deleteDraft(
  db: Kysely<Database>,
  scope: TenantScope,
  documentId: number,
): Promise<number | null> {
  const row = await db
    .deleteFrom('cla_drafts')
    .where('installation_id', '=', scope.installationId)
    .where('document_id', '=', documentId)
    .returning('revision')
    .executeTakeFirst();
  return row?.revision ?? null;
}
