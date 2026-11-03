// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { SIGNATURE_EXPORT_DEFAULT_STATE, SIGNATURE_EXPORT_STATES } from '../../../shared/signature-export.ts';
import { instantText } from './query-values.ts';

// What a request for the signature CSV may carry (E16-S03). The path and the query string are untrusted input: every value is
// checked here, and a value that fails is a `400`.

/**
 * The path parameters of the export, as text. The guard reads them as the path carries them and answers a `400` for one that
 * is not an id, so the schema leaves them as they are: a number made here would be a value the guard cannot read. The
 * handler turns the document id into a number once the guard has let the call through.
 */
export const signatureCsvParamsSchema = z.object({ installationId: z.string(), documentId: z.string() });

/**
 * The query string of `GET …/signatures.csv`. `state` is one of the four words and defaults to `all`; `from` is inclusive and
 * `to` exclusive, both on the time of the signature. A parameter it does not know is an error too, so a misspelt filter shows
 * up as a `400` and not as an export of everything.
 */
export const signatureCsvQuerySchema = z.strictObject({
  state: z.enum(SIGNATURE_EXPORT_STATES).default(SIGNATURE_EXPORT_DEFAULT_STATE),
  from: instantText.optional(),
  to: instantText.optional(),
});
