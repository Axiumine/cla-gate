// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { ALLOWLIST_LOGIN_PATTERN } from '../../../shared/allowlist.ts';
import type { EntryPosition, RepositoryEntryFrom } from '../../services/allowlist-entry-types.ts';
import { decodeCursor, encodeCursor } from './cursor.ts';

// The cursors of the lists of the allowlist (E14-S07): the position of the first entry of the next page, `[kind, login, id]`, the
// triple the lists are ordered by, and for the list of a repository the section it is in before them (`own` entries come before the
// `inherited` ones). Opaque to the client and read here with a zod schema, so a cursor that was cut, edited or made up is a `400`,
// and the login that reaches the statement has the shape of one.

const kindSchema = z.enum(['user', 'bot', 'org_members']);

/** The login of the entry the page starts at, or null when that entry has none (the entries with none come last). */
const loginSchema = z.string().regex(ALLOWLIST_LOGIN_PATTERN).nullable();

const idSchema = z.int().positive();

const positionSchema = z
  .tuple([kindSchema, loginSchema, idSchema])
  .transform(([kind, loginSnapshot, id]): EntryPosition => ({ kind, loginSnapshot, id }));

const fromSchema = z.tuple([z.enum(['own', 'inherited']), kindSchema, loginSchema, idSchema]).transform(
  ([section, kind, loginSnapshot, id]): RepositoryEntryFrom => ({
    section,
    position: { kind, loginSnapshot, id },
  }),
);

/** The opaque cursor that sends a client to the page of the installation's entries starting at `position`. */
export function entryCursor(position: EntryPosition): string {
  return encodeCursor([position.kind, position.loginSnapshot, position.id]);
}

/** The position a cursor of the installation's list stands for. @throws AppError 400 `bad_request` when the cursor is not one this server made. */
export function readEntryCursor(cursor: string): EntryPosition {
  return decodeCursor(positionSchema, cursor);
}

/** The opaque cursor that sends a client to the page of a repository's entries starting at `from`. */
export function repositoryEntryCursor(from: RepositoryEntryFrom): string {
  const { kind, loginSnapshot, id } = from.position;
  return encodeCursor([from.section, kind, loginSnapshot, id]);
}

/** The start a cursor of a repository's list stands for. @throws AppError 400 `bad_request` when the cursor is not one this server made. */
export function readRepositoryEntryCursor(cursor: string): RepositoryEntryFrom {
  return decodeCursor(fromSchema, cursor);
}
