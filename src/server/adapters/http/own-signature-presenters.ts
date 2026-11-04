// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import type { OwnSignaturesPage } from '../../../shared/own-signatures.ts';
import type { OwnSignaturePage } from '../../services/own-signatures.ts';
import type { OwnSignaturePosition } from '../../services/own-signatures-queries.ts';
import { decodeCursor, encodeCursor } from './cursor.ts';

// The list of a person's own signatures as `GET /api/me/signatures` sends it (E13-S06): the stored rows with their instants as
// ISO 8601, and the opaque cursor that stands for the row the next page starts at.

/** The first year Postgres stores: `0000-…` is a calendar instant to zod and a statement that fails in the database. */
const NO_YEAR_ZERO = /^(?!0000)/u;

/**
 * The cursor stands for `[signedAt, id]`: a real calendar instant with six decimals and the `Z` of UTC, from the year 0001, and a
 * positive integer. The six decimals are the precision of the column, so two signatures of one millisecond keep their order.
 */
const positionSchema = z
  .tuple([z.iso.datetime({ precision: 6 }).regex(NO_YEAR_ZERO), z.int().positive()])
  .transform(([signedAt, id]): OwnSignaturePosition => ({ signedAt, id }));

/** The opaque cursor that sends a client to the page starting at `position`. */
function cursorOf(position: OwnSignaturePosition): string {
  return encodeCursor([position.signedAt, position.id]);
}

/** The place a cursor stands for. @throws AppError 400 `bad_request` when the cursor is not one this server made. */
export function readOwnSignatureCursor(cursor: string): OwnSignaturePosition {
  return decodeCursor(positionSchema, cursor);
}

/** A page as `ownSignaturesPageSchema` has it: instants as ISO 8601 in UTC, and the cursor of the next page or `null`. */
export function presentOwnSignatures(page: OwnSignaturePage): OwnSignaturesPage {
  return {
    items: page.items.map((item) => ({
      ...item,
      signedAt: item.signedAt.toISOString(),
      revokedAt: item.revokedAt?.toISOString() ?? null,
    })),
    nextCursor: page.next === null ? null : cursorOf(page.next),
  };
}
