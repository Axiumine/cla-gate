// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { PAGE_SIZE } from './cla.ts';
import { defineRoute } from './contract.ts';
import { installationParamsSchema } from './installations.ts';
import { SIGNATURE_EXPORT_STATES } from './signature-export.ts';
import {
  SIGNATURE_REVOKE_PATH,
  signatureRevokeRequestSchema,
  signatureRevokeResponseSchema,
} from './signature-revoke.ts';
import { SIGNATURE_SEARCH_MAX_LOGIN, SIGNATURES_PATH, signatureSearchPageSchema } from './signature-search.ts';

// The route descriptors of the signature API (E15-S02, E15-S03) that the signatures screen of E18-S07 calls by: the paths and the
// schemas of the answers are those of signature-search.ts and signature-revoke.ts, so the screen and the server cannot drift apart.
// The CSV export (E16-S03) has no descriptor: it is a file the browser downloads, and the screen only builds its address from
// `SIGNATURES_CSV_PATH`.

/** The longest `cursor` the server reads: the cursor it makes is about 70 characters, and a longer text is not one of its own. */
const MAX_CURSOR_LENGTH = 1024;

const id = z.int().positive();

/**
 * What the screen may ask the search for: a page (`limit` of 1 to 100 and the `cursor` of the page before), the state, the document,
 * and one of the two exact ways to find a signer: the numeric GitHub id, or the login (exact, whatever its case, never a prefix).
 * Any other key is an error here as it is a `400` at the server.
 */
const signatureSearchQuerySchema = z.strictObject({
  documentId: id.optional(),
  state: z.enum(SIGNATURE_EXPORT_STATES).optional(),
  githubUserId: id.optional(),
  login: z.string().min(1).max(SIGNATURE_SEARCH_MAX_LOGIN).optional(),
  limit: z.int().min(1).max(PAGE_SIZE.max).optional(),
  cursor: z.string().min(1).max(MAX_CURSOR_LENGTH).optional(),
});

/** The path parameters of one signature of the tenant: the installation and `signatures.id`. */
const signatureParamsSchema = installationParamsSchema.extend({ signatureId: id });

/** `GET .../installations/:installationId/signatures` (E15-S02): the signatures of the tenant a maintainer may act on, newest first. */
export const signatureSearchRoute = defineRoute({
  method: 'GET',
  path: SIGNATURES_PATH,
  params: installationParamsSchema,
  query: signatureSearchQuerySchema,
  responses: { 200: signatureSearchPageSchema },
});

/** `POST .../installations/:installationId/signatures/:signatureId/revoke` (E15-S03): revokes one signature, from now on and not before. */
export const signatureRevokeRoute = defineRoute({
  method: 'POST',
  path: SIGNATURE_REVOKE_PATH,
  params: signatureParamsSchema,
  body: signatureRevokeRequestSchema,
  responses: { 200: signatureRevokeResponseSchema },
});
