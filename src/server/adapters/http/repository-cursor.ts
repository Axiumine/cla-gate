// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import type { RepositoryPosition } from '../../services/repository-entry.ts';
import { decodeCursor, encodeCursor } from './cursor.ts';

// The cursor of a page of repositories (E14-S01): the position of the first repository of the next page, `[fullName, id]`,
// the pair the list is ordered by. Opaque to the client, read here with a zod schema, so a cursor that was cut, edited or made
// up is a `400` and never a query on a value nobody checked.

/** A name a cursor may carry: text the database stores (no lone surrogate, no NUL) and no longer than GitHub allows. */
const storableName = z
  .string()
  .max(256)
  .refine((name) => name.isWellFormed() && !name.includes('\0'));

const positionSchema = z
  .tuple([storableName, z.int().positive()])
  .transform(([fullName, id]): RepositoryPosition => ({ fullName, id }));

/** The opaque cursor that sends a client to the page starting at `position`. */
export function repositoryCursor(position: RepositoryPosition): string {
  return encodeCursor([position.fullName, position.id]);
}

/** The position a cursor stands for. @throws AppError 400 `bad_request` when the cursor is not one this server made. */
export function readRepositoryCursor(cursor: string): RepositoryPosition {
  return decodeCursor(positionSchema, cursor);
}
