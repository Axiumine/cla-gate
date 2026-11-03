// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { activeVersionSchema, MAX_REVISION } from './cla.ts';

// The contract of publishing a version of a CLA (E12-S04): the body of the request, the answer, and the rationale every
// version carries. The numbering and the other rules are the server's (`publishVersion`); a screen shows the rules it
// can by calling the functions that are here.

/**
 * The longest rationale, in Unicode code points.
 * @internal exported for the tests of the limit
 */
export const RATIONALE_MAX_CODE_POINTS = 2000;

/** A carriage return with the line feed after it, or one alone: each is one line ending. */
const LINE_ENDING = /\r\n?/g;

/** What a rationale may not hold: a control character other than tab and the line ends (C0 and C1, and DEL). */
const FORBIDDEN = /(?![\t\n\r])\p{Cc}/u;

/**
 * The rationale that is stored for `raw`, or `null` when `raw` cannot be one: a string with a lone surrogate (the database
 * cannot hold it) or a control character other than tab and line feed, or one with nothing but white space, or one of more than
 * 2 000 code points once trimmed. Line endings become LF and the ends are trimmed; nothing else changes, so a hostile text
 * (`<script>`, a formula, a mention) is a valid rationale and is returned unchanged, and every output escapes it for its own
 * context. The text is never copied into an audit row.
 */
export function normaliseRationale(raw: string): string | null {
  if (!raw.isWellFormed()) {
    return null;
  }
  const lines = raw.replaceAll(LINE_ENDING, '\n');
  if (FORBIDDEN.test(lines)) {
    return null;
  }
  const rationale = lines.trim();
  // A code point takes one or two UTF-16 units, so a text of more than twice the limit in units is over it without counting.
  if (rationale.length === 0 || rationale.length > 2 * RATIONALE_MAX_CODE_POINTS) {
    return null;
  }
  return Array.from(rationale).length <= RATIONALE_MAX_CODE_POINTS ? rationale : null;
}

/** How a new version is numbered: a major bump forces everyone to sign again, a minor one does not. */
const VERSION_BUMPS = ['major', 'minor'] as const;

export type VersionBump = (typeof VERSION_BUMPS)[number];

/**
 * Where the text of a new version comes from: the saved draft (E12-S04), or a copy of a version the document already has
 * (E12-S06, a rollback: the old text is published again as a new row; the old row is never reactivated).
 */
const publishSourceSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('draft'), revision: z.int().min(1).max(MAX_REVISION) }),
  z.strictObject({ type: z.literal('version'), versionId: z.int().positive() }),
]);

/** The source of a publish, as the body names it. */
export type PublishSource = z.infer<typeof publishSourceSchema>;

/**
 * The body of `POST .../documents/:documentId/versions`. Strict: a key nobody defined is a 400. `expectedActiveVersionId` is the
 * active version the admin saw (`null` when the document has none) and is required: a publish over a version the admin has not
 * seen is refused. The rationale is cleaned by the server (`normaliseRationale`), so one that cannot be a rationale is a 422 and
 * not a 400.
 */
export const publishVersionRequestSchema = z.strictObject({
  source: publishSourceSchema,
  bump: z.enum(VERSION_BUMPS),
  rationale: z.string(),
  expectedActiveVersionId: z.int().positive().nullable(),
  acknowledgeResigning: z.boolean().optional(),
});

/**
 * `201`: the version as published, whether signers must sign again (a major bump over an existing version) and how many
 * signatures of the previous major that affects (0 for a minor bump and for the first version).
 */
export const publishVersionResponseSchema = z.object({
  version: activeVersionSchema,
  requiresResigning: z.boolean(),
  affectedSignatures: z.int().min(0),
});
