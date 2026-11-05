// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { PendingPosition } from '../../services/pending-prs-position.ts';
import { decodeCursor, encodeCursor, instantPositionSchema } from './cursor.ts';

// The cursor of the list of pending pull requests (E15-S07): the position of the first row of the next page, `[updatedAt, id]`, the pair
// the list is ordered by. Opaque to the client, read here with a zod schema, so a cursor that was cut, edited or made up is a `400` and
// never a query on a value nobody checked.

/** The cursor stands for `[updatedAt, id]`, the pair the list is ordered by (the shape of {@link instantPositionSchema}). */
const positionSchema = instantPositionSchema.transform(([updatedAt, id]): PendingPosition => ({ updatedAt, id }));

/** The opaque cursor that sends a client to the page starting at `position`. */
export function pendingCursor(position: PendingPosition): string {
  return encodeCursor([position.updatedAt, position.id]);
}

/** The position a cursor stands for. @throws AppError 400 `bad_request` when the cursor is not one this server made. */
export function readPendingCursor(cursor: string): PendingPosition {
  return decodeCursor(positionSchema, cursor);
}
