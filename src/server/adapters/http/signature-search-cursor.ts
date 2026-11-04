// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import type { SignaturePosition } from '../../services/signature-search-filter.ts';
import { decodeCursor, encodeCursor } from './cursor.ts';

// The cursor of the search for signatures (E15-S02): the position of the first row of the next page, `[signedAt, id]`, the pair the
// list is ordered by. Opaque to the client, read here with a zod schema, so a cursor that was cut, edited or made up is a `400` and
// never a query on a value nobody checked.

/** The first year Postgres stores: `0000-…` is a calendar instant to zod and a statement that fails in the database. */
const NO_YEAR_ZERO = /^(?!0000)/u;

/**
 * The cursor stands for `[signedAt, id]`: a real calendar instant with six decimals and the `Z` of UTC, from the year 0001, and a
 * positive integer. The six decimals are the precision of the column, so two signatures of one millisecond keep their order.
 */
const positionSchema = z
  .tuple([z.iso.datetime({ precision: 6 }).regex(NO_YEAR_ZERO), z.int().positive()])
  .transform(([signedAt, id]): SignaturePosition => ({ signedAt, id }));

/** The opaque cursor that sends a client to the page starting at `position`. */
export function signatureCursor(position: SignaturePosition): string {
  return encodeCursor([position.signedAt, position.id]);
}

/** The position a cursor stands for. @throws AppError 400 `bad_request` when the cursor is not one this server made. */
export function readSignatureCursor(cursor: string): SignaturePosition {
  return decodeCursor(positionSchema, cursor);
}
