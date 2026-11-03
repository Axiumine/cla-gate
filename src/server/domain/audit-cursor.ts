// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

// The cursor of the audit log listing (E16-S02): where the next page starts. It is opaque to the client, which hands back
// what it was given, and it is input like any other: whatever arrives is parsed here, and a value that is not one of ours
// is refused before it can reach a query.

/**
 * A place in the listing, between two rows: the instant of a row and its id. The instant is kept at the microsecond
 * precision the database stores (`2026-11-02T10:00:00.123456Z`), because two rows of one millisecond can be told apart
 * only by it, and a cursor that rounded it would skip or repeat them.
 */
export interface AuditCursor {
  readonly occurredAt: string;
  readonly id: number;
}

/** The most characters of a cursor we read: ours is about 70, and a longer string is not one of ours. */
const MAX_CURSOR_CHARACTERS = 128;

/** `base64url` of `[occurredAt, id]` as JSON. */
export function encodeAuditCursor(cursor: AuditCursor): string {
  return Buffer.from(JSON.stringify([cursor.occurredAt, cursor.id]), 'utf8').toString('base64url');
}

/**
 * The value the text carries, or `undefined` when it is not canonical base64url or not JSON. Canonical means that encoding
 * the bytes again gives the text back: the decoder of Node skips characters it does not know, and two texts must not stand
 * for one cursor.
 */
function decodeCursorText(text: string): unknown {
  const bytes = Buffer.from(text, 'base64url');
  if (bytes.toString('base64url') !== text) {
    return undefined;
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return undefined;
  }
}

/** The first year Postgres stores: `0000-…` is a calendar instant to zod and a statement that fails in the database. */
const NO_YEAR_ZERO = /^(?!0000)/;

const position = z.tuple([z.iso.datetime({ precision: 6 }).regex(NO_YEAR_ZERO), z.int().positive()]);

/**
 * Reads the cursor a client sent back: base64url characters only, canonical, JSON, and a two-element array of a real
 * calendar instant with six decimals, from the year 0001, and a positive integer. Anything else fails, and the route answers `400`.
 */
export const auditCursorSchema = z
  .string()
  .max(MAX_CURSOR_CHARACTERS)
  .regex(/^[\w-]+$/)
  .transform(decodeCursorText)
  .pipe(position)
  .transform(([occurredAt, id]): AuditCursor => ({ occurredAt, id }));
