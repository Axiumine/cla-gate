// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

// The contract of the CLA documents API (epic E12): the paths, the request bodies, the response bodies and the rules a
// request can break. The server serialises with these schemas and the screens of E18 parse with them. No CLA text lives
// here or anywhere in the product: a maintainer brings their own (E12-S03).

/** `/api/installations/:installationId/documents`: create and list (E12-S01). `:installationId` is `installations.id`. */
export const DOCUMENTS_PATH = '/api/installations/:installationId/documents';

/** One document: read and rename (E12-S01). Draft and versions hang below it (E12-S03 to E12-S06). */
export const DOCUMENT_PATH = `${DOCUMENTS_PATH}/:documentId`;

/** The documents a repository admin sees for one repository (E12-S01). */
export const REPOSITORY_DOCUMENTS_PATH = '/api/installations/:installationId/repositories/:repositoryId/documents';

/**
 * Who signs under a document. The schema accepts both; the corporate kind is switched on by E21.
 * @internal exported for the tests of the schema
 */
export const CLA_DOCUMENT_KINDS = ['individual', 'corporate'] as const;

const claDocumentKindSchema = z.enum(CLA_DOCUMENT_KINDS);

export type ClaDocumentKind = z.infer<typeof claDocumentKindSchema>;

/**
 * Whether a document of the corporate kind can be created. E21 flips it when the corporate flow exists; until then the
 * service answers `422 kind_not_supported` (E12-S01).
 * @internal exported for the tests of the switch
 */
export const CORPORATE_KIND_ENABLED = false;

/** True when documents of `kind` can be created. `corporateEnabled` is a parameter so that both outcomes are tested. */
export function isKindSupported(kind: ClaDocumentKind, corporateEnabled: boolean = CORPORATE_KIND_ENABLED): boolean {
  return kind === 'individual' || corporateEnabled;
}

/** The most documents one installation holds (E12-S01). */
export const MAX_DOCUMENTS_PER_INSTALLATION = 100;

/** How many rows a page of a list holds when the request names no `limit`, and the most it may name. */
export const PAGE_SIZE = { default: 50, max: 100 } as const;

/**
 * The rules a request can break, each with the status it is answered with. The server throws them by name and the HTTP
 * layer turns each into the error body of E06-S01 (`code` is the key); later stories of E12 add their own. The three
 * `content_` rules are those of the text of a CLA (E12-S02, `validateClaText`).
 */
export const CLA_RULE_STATUS = {
  invalid_name: 422,
  kind_not_supported: 422,
  document_limit_reached: 422,
  document_name_taken: 409,
  content_too_large: 422,
  content_empty: 422,
  content_invalid_characters: 422,
  not_found: 404,
} as const;

export type ClaRule = keyof typeof CLA_RULE_STATUS;

/**
 * The body of `POST /api/installations/:installationId/documents`. Strict: a key nobody defined (an `installationId` in
 * the body, say) is a 400. Without `repositoryId` the document covers the whole installation. The name is cleaned by the
 * server (`normaliseDocumentName`), so a name that cannot be one is a 422 and not a 400.
 */
export const createDocumentRequestSchema = z.strictObject({
  name: z.string(),
  kind: claDocumentKindSchema,
  repositoryId: z.int().positive().optional(),
});

/** The body of `PATCH .../documents/:documentId`: the new name, cleaned like the one at creation. */
export const renameDocumentRequestSchema = z.strictObject({ name: z.string() });

/** The query of the document list: a plain-digit `limit` of 1 to 100 and the `cursor` an earlier page answered with. */
export const listDocumentsQuerySchema = z.strictObject({
  limit: z
    .string()
    .regex(/^[1-9]\d{0,2}$/)
    .transform(Number)
    .pipe(z.int().max(PAGE_SIZE.max))
    .optional(),
  cursor: z.string().min(1).max(1024).optional(),
});

/** A time as the API tells it: ISO 8601 in UTC. */
const instant = z.iso.datetime();

/** The version a document is currently signed against: its number, the hash of the exact text, and when it was published. */
export const activeVersionSchema = z.object({
  id: z.int().positive(),
  major: z.int().min(1),
  minor: z.int().min(0),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  publishedAt: instant,
});

/** A document as the list, the create and the rename answer with it. `scope` follows `repositoryId`. */
export const claDocumentSchema = z.object({
  id: z.int().positive(),
  name: z.string(),
  kind: claDocumentKindSchema,
  scope: z.enum(['installation', 'repository']),
  repositoryId: z.int().positive().nullable(),
  activeVersion: activeVersionSchema.nullable(),
  createdAt: instant,
  updatedAt: instant,
});

/** A document as `GET .../documents/:documentId` answers: `hasDraft` says whether work in progress is saved (E12-S03). */
export const claDocumentDetailSchema = claDocumentSchema.extend({ hasDraft: z.boolean() });

export const documentResponseSchema = z.object({ document: claDocumentSchema });

export const documentDetailResponseSchema = z.object({ document: claDocumentDetailSchema });

/** One page of the documents of an installation; `nextCursor` is null on the last page. */
export const documentListResponseSchema = z.object({
  documents: z.array(claDocumentSchema),
  nextCursor: z.string().nullable(),
});

/**
 * What a repository admin sees of a document that covers the whole installation: its id, its name and the number of
 * its active version. Never the text, the hash or a time: the admin of one repository does not manage that document.
 */
export const installationScopedEntrySchema = z.object({
  id: z.int().positive(),
  name: z.string(),
  activeVersion: z.object({ major: z.int().min(1), minor: z.int().min(0) }).nullable(),
});

/** `GET .../repositories/:repositoryId/documents`: the repository's own documents, then the installation-wide ones that cover it. */
export const repositoryDocumentsResponseSchema = z.object({
  repositoryScoped: z.array(claDocumentSchema),
  installationScoped: z.array(installationScopedEntrySchema),
});
