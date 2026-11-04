// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

// The contract of the CLA a repository enforces (E14-S02): the path, the body that attaches or detaches a document and the
// answer. The route, its tests and the screens of the dashboard share them. `:repositoryId` is `repositories.id`, never
// GitHub's id, and the installation is not in the path: the server finds it from the repository and authorises the person
// against it.

/** `PUT`: attach a CLA document to a repository, or detach the one it has (E14-S02). */
export const REPOSITORY_CLA_DOCUMENT_PATH = '/api/repositories/:repositoryId/cla-document';

/**
 * The body of the call: the `cla_documents.id` to attach, or `null` to detach. Strict, so a key nobody defined (an
 * `installationId`, say) is a `400` and never quietly ignored. An id that names nothing the repository may enforce is a
 * `422`, not a `400`: the body is well formed, the document is not attachable.
 */
export const repositoryDocumentRequestSchema = z.strictObject({
  documentId: z.int().positive().nullable(),
});

/**
 * The answer: the document the repository enforces now (`null` after a detach) and whether the call changed anything.
 * `changed: false` is the answer to a call that asked for what already was; it wrote no audit row and sent no job.
 */
export const repositoryDocumentResponseSchema = z.object({
  documentId: z.int().positive().nullable(),
  changed: z.boolean(),
});
