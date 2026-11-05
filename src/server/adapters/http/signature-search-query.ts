// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { PAGE_SIZE } from '../../../shared/cla.ts';
import { SIGNATURE_EXPORT_DEFAULT_STATE, SIGNATURE_EXPORT_STATES } from '../../../shared/signature-export.ts';
import { SIGNATURE_SEARCH_MAX_LOGIN } from '../../../shared/signature-search.ts';
import { idText } from './query-values.ts';

// What a search for signatures may carry (E15-S02). The query string is untrusted input: every value is checked here, and a value that
// fails is a `400`. The signer is named by the numeric GitHub id, or by the login the signer gave when signing, which is matched
// exactly and whatever its case; neither is ever a prefix.

/** The longest `cursor` the server reads: the cursor it makes is about 70 characters, and a longer text is not one of its own. */
const MAX_CURSOR_LENGTH = 1024;

/** The `limit` of a page: 1 to {@link PAGE_SIZE}`.max` in plain digits, {@link PAGE_SIZE}`.default` when absent. */
const limitText = z
  .string()
  .regex(/^[1-9]\d{0,2}$/)
  .transform(Number)
  .pipe(z.int().max(PAGE_SIZE.max))
  .default(PAGE_SIZE.default);

/** A login the database can hold: not empty, not longer than a search takes, no lone surrogate and no NUL, which the driver refuses. */
const loginText = z
  .string()
  .min(1)
  .max(SIGNATURE_SEARCH_MAX_LOGIN)
  .refine((text) => text.isWellFormed() && !text.includes('\0'));

/**
 * The query string of `GET …/signatures`. `state` is one of the four words and defaults to `all`; `cursor` is what an earlier page
 * returned as `nextCursor`. A parameter it does not know is an error too, so a misspelt filter shows up as a `400` and not as an
 * unfiltered list.
 */
export const signatureSearchQuerySchema = z.strictObject({
  documentId: idText.optional(),
  state: z.enum(SIGNATURE_EXPORT_STATES).default(SIGNATURE_EXPORT_DEFAULT_STATE),
  githubUserId: idText.optional(),
  login: loginText.optional(),
  limit: limitText,
  cursor: z.string().min(1).max(MAX_CURSOR_LENGTH).optional(),
});
