// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import {
  createDocumentRequestSchema,
  DOCUMENT_PATH,
  DOCUMENTS_PATH,
  DRAFT_PATH,
  documentDetailResponseSchema,
  documentListResponseSchema,
  documentResponseSchema,
  draftResponseSchema,
  pageQuerySchema,
  saveDraftRequestSchema,
  savedDraftResponseSchema,
  VERSION_PATH,
  VERSIONS_PATH,
} from './cla.ts';
import { versionListResponseSchema, versionResponseSchema } from './cla-history.ts';
import { publishVersionRequestSchema, publishVersionResponseSchema } from './cla-version.ts';
import { defineRoute } from './contract.ts';
import { installationParamsSchema } from './installations.ts';

// The route descriptors of the CLA documents API (E12-S01 to E12-S05) that the document screens of E18-S05 call by: the paths and
// the schemas are those of cla.ts, cla-version.ts and cla-history.ts, so the screens and the server cannot drift apart.

/** The two numbers every route of one document has in its path: the tenant (`installations.id`) and the document (`cla_documents.id`). */
const documentParamsSchema = installationParamsSchema.extend({ documentId: z.int().positive() });

/** `GET .../documents?limit=&cursor=` (E12-S01): the documents of an installation by name and id, for an org admin. */
export const documentListRoute = defineRoute({
  method: 'GET',
  path: DOCUMENTS_PATH,
  params: installationParamsSchema,
  query: pageQuerySchema,
  responses: { 200: documentListResponseSchema },
});

/** `POST .../documents` (E12-S01): creates a document; the rules it can break are `CLA_RULE_STATUS` entries. */
export const createDocumentRoute = defineRoute({
  method: 'POST',
  path: DOCUMENTS_PATH,
  params: installationParamsSchema,
  body: createDocumentRequestSchema,
  responses: { 201: documentResponseSchema },
});

/** `GET .../documents/:documentId` (E12-S01): one document with its active version and whether a draft is saved. */
export const documentRoute = defineRoute({
  method: 'GET',
  path: DOCUMENT_PATH,
  params: documentParamsSchema,
  responses: { 200: documentDetailResponseSchema },
});

/** `GET .../documents/:documentId/draft` (E12-S03): the draft with its text, or `null` when none is saved. */
export const readDraftRoute = defineRoute({
  method: 'GET',
  path: DRAFT_PATH,
  params: documentParamsSchema,
  responses: { 200: draftResponseSchema },
});

/** `PUT .../documents/:documentId/draft` (E12-S03): saves the draft at the revision the editor read; `409 draft_conflict` when it moved. */
export const saveDraftRoute = defineRoute({
  method: 'PUT',
  path: DRAFT_PATH,
  params: documentParamsSchema,
  body: saveDraftRequestSchema,
  responses: { 200: savedDraftResponseSchema },
});

/** `DELETE .../documents/:documentId/draft` (E12-S03): `204`, also when no draft exists. */
export const discardDraftRoute = defineRoute({
  method: 'DELETE',
  path: DRAFT_PATH,
  params: documentParamsSchema,
  responses: { 204: z.undefined() },
});

/** `POST .../documents/:documentId/versions` (E12-S04): publishes the saved draft as the next version. */
export const publishVersionRoute = defineRoute({
  method: 'POST',
  path: VERSIONS_PATH,
  params: documentParamsSchema,
  body: publishVersionRequestSchema,
  responses: { 201: publishVersionResponseSchema },
});

/** `GET .../documents/:documentId/versions?limit=&cursor=` (E12-S05): the history of a document, newest number first, one page at a time (E18-S11). */
export const versionListRoute = defineRoute({
  method: 'GET',
  path: VERSIONS_PATH,
  params: documentParamsSchema,
  query: pageQuerySchema,
  responses: { 200: versionListResponseSchema },
});

/** `GET .../documents/:documentId/versions/:versionId` (E12-S05): one version with its exact text. */
export const versionRoute = defineRoute({
  method: 'GET',
  path: VERSION_PATH,
  params: documentParamsSchema.extend({ versionId: z.int().positive() }),
  responses: { 200: versionResponseSchema },
});
