// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { activeVersionSchema } from './cla.ts';

// The contract of the history of a document (E12-S05): the versions in the order of their numbers, and one version with its
// exact text. The server serialises with these schemas and the history screen of E18 parses with them. Strings the people
// typed (the rationale, a login) are sent as they are stored; escaping is each screen's job.

/** Who published a version: the numeric GitHub id, which is the identity, and the login as the `users` row holds it (`erased-<id>` once the person is erased). */
const publishedBySchema = z.object({ githubId: z.int().positive(), login: z.string() });

/**
 * A version in the history: the fields of the active version of a document plus who published it and why, whether it is the
 * version the document points at, and how many signatures that are not revoked were made on exactly this version.
 */
export const versionSummarySchema = activeVersionSchema.extend({
  publishedBy: publishedBySchema,
  rationale: z.string(),
  active: z.boolean(),
  signatureCount: z.int().min(0),
});

/** One version with `contentMd`, the canonical text as it is stored and as `contentSha256` was computed over it. */
export const versionDetailSchema = versionSummarySchema.extend({ contentMd: z.string() });

/** One page of the history, newest number first; `nextCursor` is null on the last page. */
export const versionListResponseSchema = z.object({
  versions: z.array(versionSummarySchema),
  nextCursor: z.string().nullable(),
});

/** `GET .../versions/:versionId`. */
export const versionResponseSchema = z.object({ version: versionDetailSchema });
