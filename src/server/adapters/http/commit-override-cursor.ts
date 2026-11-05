// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { OverridePosition } from '../../services/commit-override-list-queries.ts';
import { decodeCursor, encodeCursor, instantPositionSchema } from './cursor.ts';

// The cursor of the list of per-commit overrides (E15-S06): the position of the first row of the next page, `[createdAt, id]`, the pair
// the list is ordered by. Opaque to the client, read here with a zod schema, so a cursor that was cut, edited or made up is a `400` and
// never a query on a value nobody checked.

/** The cursor stands for `[createdAt, id]`, the pair the list is ordered by (the shape of {@link instantPositionSchema}). */
const positionSchema = instantPositionSchema.transform(([createdAt, id]): OverridePosition => ({ createdAt, id }));

/** The opaque cursor that sends a client to the page starting at `position`. */
export function overrideCursor(position: OverridePosition): string {
  return encodeCursor([position.createdAt, position.id]);
}

/** The position a cursor stands for. @throws AppError 400 `bad_request` when the cursor is not one this server made. */
export function readOverrideCursor(cursor: string): OverridePosition {
  return decodeCursor(positionSchema, cursor);
}
