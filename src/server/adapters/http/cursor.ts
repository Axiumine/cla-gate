// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { AppError } from './errors.ts';

// The opaque cursor of a paged list (E12-S01, E12-S05): the position of the first row of the next page, as the base64url
// of its JSON. It is opaque to the client, which sends back what it was given; the server reads it with a zod schema, so a
// cursor that was cut, edited or made up is a `400`, never a query on a value nobody checked.

/** The cursor that stands for `position` (the values the list is ordered by). */
export function encodeCursor(position: unknown): string {
  return Buffer.from(JSON.stringify(position), 'utf8').toString('base64url');
}

/**
 * The position a cursor stands for. The text must be exactly what {@link encodeCursor} makes: base64url without padding
 * or stray characters (Node's decoder skips what it does not know, so the text is encoded again and compared), JSON, and a
 * value `schema` accepts.
 * @throws AppError 400 `bad_request` for anything else.
 */
export function decodeCursor<T>(schema: z.ZodType<T>, cursor: string): T {
  const bytes = Buffer.from(cursor, 'base64url');
  if (bytes.toString('base64url') !== cursor) {
    throw new AppError(400, 'bad_request');
  }
  const parsed = schema.safeParse(parseJson(bytes.toString('utf8')));
  if (!parsed.success) {
    throw new AppError(400, 'bad_request');
  }
  return parsed.data;
}

/** The JSON value in `text`, or `undefined` (which no cursor schema accepts) when it is not JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The first year Postgres stores: `0000-…` is a calendar instant to zod and a statement that fails in the database. */
const NO_YEAR_ZERO = /^(?!0000)/u;

/**
 * The position `[instant, id]` of a list ordered by a timestamp and an id (E15-S02, E15-S06): a real calendar instant with six
 * decimals and the `Z` of UTC, from the year 0001, and a positive integer. The six decimals are the precision of a `timestamptz`
 * column, so two rows of one millisecond keep their order. A list reads it with `.transform` into its own position type.
 */
export const instantPositionSchema = z.tuple([
  z.iso.datetime({ precision: 6 }).regex(NO_YEAR_ZERO),
  z.int().positive(),
]);
