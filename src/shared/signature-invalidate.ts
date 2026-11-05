// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { revokeReasonSchema } from './signature-revoke.ts';

// The contract of invalidating every signature of one major version of a document (E15-S04): the two paths, the body, the query and the
// answers. The routes, their tests and the screen that invalidates a major (E18) share them. Like a revocation, an invalidation is
// prospective and has no undo: the signatures stop covering the pull requests evaluated from now on, contributions already accepted
// stay licensed, and the people who should be covered again sign again (a new row each, E13-S04). No version of the document changes.

/** `GET`: what invalidating a major would do, as counts only. `:installationId` is `installations.id`, `:documentId` is `cla_documents.id`. */
export const INVALIDATION_PREVIEW_PATH =
  '/api/installations/:installationId/documents/:documentId/invalidation-preview';

/** `POST`: invalidate the signatures of one major of a document (E15-S04). */
export const INVALIDATIONS_PATH = '/api/installations/:installationId/documents/:documentId/invalidations';

/** The largest major a request may name: the `integer` column of `cla_versions.major` and `signatures.major` holds no more. */
const MAX_MAJOR = 2_147_483_647;

/** A major version: a positive whole number the column can hold. Major 0 has never existed (`check (major >= 1)`, migration 001). */
const majorSchema = z.int().positive().max(MAX_MAJOR);

/** The query of the preview: the major in plain digits (no sign, no leading zero, no exponent), and nothing else. */
export const invalidationPreviewQuerySchema = z.strictObject({
  major: z
    .string()
    .regex(/^[1-9]\d{0,9}$/)
    .transform(Number)
    .pipe(majorSchema),
});

/**
 * The answer of the preview: the major asked about, how many of its signatures are in force, and how many repositories would be swept
 * (the enabled ones that enforce the document). Counts only: no signer, no name, no address.
 */
export const invalidationPreviewResponseSchema = z.strictObject({
  major: majorSchema,
  activeSignatures: z.int().nonnegative(),
  affectedRepositories: z.int().nonnegative(),
});

export type InvalidationPreviewResponse = z.infer<typeof invalidationPreviewResponseSchema>;

/**
 * The body of an invalidation: the major, the reason code of a revocation (the set the database checks on `signatures.revoke_reason`,
 * never free text) and the number of signatures the maintainer saw in the preview, which the server holds the invalidation to: a count
 * of 0 is refused here, as there is nothing to confirm. A key nobody defined is a `400`.
 */
export const invalidationRequestSchema = z.strictObject({
  major: majorSchema,
  reasonCode: revokeReasonSchema,
  expectedCount: z.int().positive(),
});

/** The answer of an invalidation: how many signatures were taken out of force. */
export const invalidationResponseSchema = z.strictObject({ invalidated: z.int().positive() });

export type InvalidationResponse = z.infer<typeof invalidationResponseSchema>;
