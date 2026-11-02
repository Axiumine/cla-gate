// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from './schema.ts';

// Ending a session on purpose (E10-S05): the login callback deletes the session the browser presented before it issues a new one.

/** Deletes one session row by `sessions.id`. A row that is already gone is not an error: both ways the session is over. */
export async function deleteSession(db: Kysely<Database>, rowId: number): Promise<void> {
  await db.deleteFrom('sessions').where('id', '=', rowId).execute();
}
