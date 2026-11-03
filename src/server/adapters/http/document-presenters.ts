// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import type {
  activeVersionSchema,
  claDocumentDetailSchema,
  claDocumentSchema,
  claDraftSchema,
  installationScopedEntrySchema,
  savedDraftResponseSchema,
} from '../../../shared/cla.ts';
import type { publishVersionResponseSchema } from '../../../shared/cla-version.ts';
import type { DocumentPosition, StoredActiveVersion, StoredDocument } from '../../services/cla-document-types.ts';
import type { DocumentDetail } from '../../services/cla-documents.ts';
import type { StoredDraft } from '../../services/cla-draft-queries.ts';
import type { SavedDraft } from '../../services/cla-draft-writes.ts';
import type { PublishedVersion } from '../../services/cla-publish-types.ts';
import { decodeCursor, encodeCursor } from './cursor.ts';

// The documents of the API as the routes of document-routes.ts send them (E12-S01): the stored rows with their times as
// ISO 8601 and the scope spelled out. Strings (the name) are sent as they are stored; escaping is each screen's job.

type ActiveVersion = z.infer<typeof activeVersionSchema>;

function presentVersion(version: StoredActiveVersion): ActiveVersion {
  return {
    id: version.id,
    major: version.major,
    minor: version.minor,
    contentSha256: version.contentSha256,
    publishedAt: version.publishedAt.toISOString(),
  };
}

/** A stored document as `claDocumentSchema` has it. */
export function presentDocument(document: StoredDocument): z.infer<typeof claDocumentSchema> {
  return {
    id: document.id,
    name: document.name,
    kind: document.kind,
    scope: document.repositoryId === null ? 'installation' : 'repository',
    repositoryId: document.repositoryId,
    activeVersion: document.activeVersion === null ? null : presentVersion(document.activeVersion),
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

/** A document with its draft flag as `claDocumentDetailSchema` has it. */
export function presentDetail(document: DocumentDetail): z.infer<typeof claDocumentDetailSchema> {
  return { ...presentDocument(document), hasDraft: document.hasDraft };
}

/** A stored draft as `claDraftSchema` has it: the canonical text, the revision and the time as ISO 8601. */
export function presentDraft(draft: StoredDraft): z.infer<typeof claDraftSchema> {
  return { contentMd: draft.contentMd, revision: draft.revision, updatedAt: draft.updatedAt.toISOString() };
}

/** What a save answers: the revision and the time, never the text. */
export function presentSavedDraft(draft: SavedDraft): z.infer<typeof savedDraftResponseSchema>['draft'] {
  return { revision: draft.revision, updatedAt: draft.updatedAt.toISOString() };
}

/** A published version as `publishVersionResponseSchema` has it: the version, whether signers sign again, and how many that affects. */
export function presentPublished(published: PublishedVersion): z.infer<typeof publishVersionResponseSchema> {
  return {
    version: presentVersion(published.version),
    requiresResigning: published.requiresResigning,
    affectedSignatures: published.affectedSignatures,
  };
}

/** What a repository admin sees of an installation-wide document: the id, the name and the number of the active version. */
export function presentEntry(document: StoredDocument): z.infer<typeof installationScopedEntrySchema> {
  const version = document.activeVersion;
  return {
    id: document.id,
    name: document.name,
    activeVersion: version === null ? null : { major: version.major, minor: version.minor },
  };
}

/** A name a cursor may carry: text the database stores (no lone surrogate, no NUL). */
const storableName = z.string().refine((name) => name.isWellFormed() && !name.includes('\0'));

/** The cursor of a page of documents stands for the position it starts at: `[name, id]`. */
const positionSchema = z
  .tuple([storableName, z.int().positive()])
  .transform(([name, id]): DocumentPosition => ({ name, id }));

/** The opaque cursor that sends a client to the page starting at `position`. */
export function positionCursor(position: DocumentPosition): string {
  return encodeCursor([position.name, position.id]);
}

/** The position a cursor stands for. @throws AppError 400 `bad_request` when the cursor is not one this server made. */
export function readPositionCursor(cursor: string): DocumentPosition {
  return decodeCursor(positionSchema, cursor);
}
