// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { REPOSITORY_DOCUMENTS_PATH, repositoryDocumentsResponseSchema } from './cla.ts';
import { defineRoute } from './contract.ts';
import { installationParamsSchema } from './installations.ts';
import {
  REPOSITORY_CLA_DOCUMENT_PATH,
  repositoryDocumentRequestSchema,
  repositoryDocumentResponseSchema,
} from './repository-document.ts';
import {
  REPOSITORY_DISABLE_PATH,
  REPOSITORY_ENABLE_PATH,
  repositoryEnabledResponseSchema,
} from './repository-enabled.ts';

// The route descriptors of the repository actions (E14-S02 to E14-S04) and of the documents a repository can enforce (E12-S01) that the
// Repositories screen of E18-S10 calls by: the paths and the schemas are those of repository-document.ts, repository-enabled.ts and
// cla.ts, so the screen and the server cannot drift apart. `:repositoryId` is `repositories.id`, never GitHub's id.

/** The path parameter of the actions on one repository: `repositories.id`. The server finds the installation from it. */
const repositoryParamsSchema = z.object({ repositoryId: z.int().positive() });

/**
 * `GET .../installations/:installationId/repositories/:repositoryId/documents` (E12-S01): the documents the repository may enforce,
 * its own first and then the installation-wide ones that cover it. Never their text.
 */
export const repositoryDocumentsRoute = defineRoute({
  method: 'GET',
  path: REPOSITORY_DOCUMENTS_PATH,
  params: installationParamsSchema.extend(repositoryParamsSchema.shape),
  responses: { 200: repositoryDocumentsResponseSchema },
});

/**
 * `PUT /api/repositories/:repositoryId/cla-document` (E14-S02): attaches a document, or detaches the one the repository has with
 * `{ documentId: null }`. The rules it can break are `422 document_not_attachable`, `409 document_unpublished` and
 * `409 repository_enabled`; `changed: false` says the repository enforced that document already.
 */
export const attachDocumentRoute = defineRoute({
  method: 'PUT',
  path: REPOSITORY_CLA_DOCUMENT_PATH,
  params: repositoryParamsSchema,
  body: repositoryDocumentRequestSchema,
  responses: { 200: repositoryDocumentResponseSchema },
});

/**
 * `POST /api/repositories/:repositoryId/enable` (E14-S03): turns enforcement on; it takes no body. `409 no_active_cla` is a repository
 * with no document attached, or whose document has no published version; `changed: false` says it was on already.
 */
export const enableRepositoryRoute = defineRoute({
  method: 'POST',
  path: REPOSITORY_ENABLE_PATH,
  params: repositoryParamsSchema,
  responses: { 200: repositoryEnabledResponseSchema },
});

/** `POST /api/repositories/:repositoryId/disable` (E14-S04): turns enforcement off; it takes no body and answers like the enable call. */
export const disableRepositoryRoute = defineRoute({
  method: 'POST',
  path: REPOSITORY_DISABLE_PATH,
  params: repositoryParamsSchema,
  responses: { 200: repositoryEnabledResponseSchema },
});
