// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from './schema.ts';

// Ending sessions on purpose: the login callback deletes the session the browser presented before it issues a new one
// (E10-S05), and logout deletes the one in use or all of the caller's (E10-S06).

/** Deletes one session row by `sessions.id`. A row that is already gone is not an error: both ways the session is over. */
export async function deleteSession(db: Kysely<Database>, rowId: number): Promise<void> {
  await db.deleteFrom('sessions').where('id', '=', rowId).execute();
}

/**
 * Deletes every session of one user, expired ones included, and returns how many rows went. The key is `users.id`, the
 * caller's own, taken from the authenticated request and never from the body; other users' rows are not matched
 * (`sessions_user_id_idx`).
 */
export async function deleteSessionsOfUser(db: Kysely<Database>, userId: number): Promise<number> {
  const result = await db.deleteFrom('sessions').where('user_id', '=', userId).executeTakeFirstOrThrow();
  return Number(result.numDeletedRows);
}
