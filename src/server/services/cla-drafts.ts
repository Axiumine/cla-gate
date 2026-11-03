// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { appendAudit } from './audit.ts';
import { prepareClaText } from './cla-content.ts';
import { findDocument } from './cla-document-queries.ts';
import { findDraft, findDraftRevision, type StoredDraft } from './cla-draft-queries.ts';
import { deleteDraft, insertDraft, type SavedDraft, updateDraft } from './cla-draft-writes.ts';
import { ClaRuleError } from './cla-rule-error.ts';

// The draft of a CLA text (E12-S03): work in progress that is saved by an explicit action, shared by the admins of the scope
// of the document, and never published by being saved. A published version is immutable, so the draft lives in a table of
// its own. The statements are in cla-draft-queries.ts and cla-draft-writes.ts; the text is made canonical and checked by `prepareClaText`
// (E12-S02), so what is stored is what a version would hold. A draft never changes the active version of its document.

/** The person who saves or discards: `id` is `users.id` (stored as `updated_by`), `githubId` the identity the audit row names. */
export interface DraftActor {
  readonly id: number;
  readonly githubId: GithubId;
}

/** What a save is made of: the document, the text as the editor sent it, and the revision the editor read (null: none, no draft existed). */
export interface DraftSave {
  readonly documentId: number;
  readonly contentMd: string;
  readonly expectedRevision: number | null;
}

/** The draft of the document, or null when none is saved. */
export function readDraft(db: Kysely<Database>, scope: TenantScope, documentId: number): Promise<StoredDraft | null> {
  return findDraft(db, scope, documentId);
}

/**
 * Saves the text as the draft of the document and appends the audit row `cla_draft.saved` (the document and the new
 * revision, never the text) in the same transaction. The text is made canonical and checked first. With `expectedRevision`
 * null the draft is created at revision 1; with a number the draft is replaced only while it is at that revision, and its
 * revision goes up by one, in one statement, so two saves that read the same revision cannot both succeed.
 * @throws ClaRuleError `content_too_large`, `content_empty` or `content_invalid_characters` (nothing of the text in them),
 * `draft_conflict` with `currentRevision` (null when no draft is saved) when the draft is not at the revision the editor read, and
 * `not_found` when the tenant has no such document.
 */
export async function saveDraft(
  db: Kysely<Database>,
  scope: TenantScope,
  actor: DraftActor,
  save: DraftSave,
): Promise<SavedDraft> {
  const { contentMd } = prepareClaText(save.contentMd);
  const write = { contentMd, updatedBy: actor.id };
  return db.transaction().execute(async (trx) => {
    if ((await findDocument(trx, scope, save.documentId)) === null) {
      throw new ClaRuleError('not_found');
    }
    const saved =
      save.expectedRevision === null
        ? await insertDraft(trx, scope, save.documentId, write)
        : await updateDraft(trx, scope, save.documentId, { ...write, expectedRevision: save.expectedRevision });
    if (saved === null) {
      throw new ClaRuleError('draft_conflict', {
        currentRevision: await findDraftRevision(trx, scope, save.documentId),
      });
    }
    await appendAudit(trx, {
      action: 'cla_draft.saved',
      installationId: scope.installationId,
      actorGithubId: actor.githubId,
      subject: { type: 'cla_document', id: save.documentId },
      metadata: { document_id: save.documentId, revision: saved.revision },
    });
    return saved;
  });
}

/**
 * Discards the draft of the document and appends the audit row `cla_draft.discarded` (the document and the revision that
 * was discarded) in the same transaction. When the document has no draft nothing changes and no row is written: discarding
 * twice is the same as discarding once.
 */
export async function discardDraft(
  db: Kysely<Database>,
  scope: TenantScope,
  actorGithubId: GithubId,
  documentId: number,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const revision = await deleteDraft(trx, scope, documentId);
    if (revision === null) {
      return;
    }
    await appendAudit(trx, {
      action: 'cla_draft.discarded',
      installationId: scope.installationId,
      actorGithubId,
      subject: { type: 'cla_document', id: documentId },
      metadata: { document_id: documentId, revision },
    });
  });
}
