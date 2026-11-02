// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { GithubId } from '../../../shared/github-id.ts';
import type { Database } from './schema.ts';

// Ending sessions on purpose: the login callback deletes the session the browser presented before it issues a new one
// (E10-S05), logout deletes the one in use or all of the caller's (E10-S06), and a revoked App authorization deletes all
// of a person's (E10-S07).

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

/**
 * Deletes every session of the person with this numeric GitHub id, wherever they logged in, expired ones included, and
 * returns how many rows went (E10-S07). A session says nothing about tenants, so the deletion is instance-wide by design.
 * The `users` row stays: signatures reference it. Calling it again, or with an id nobody has, deletes nothing and returns
 * 0. The key is the identity (`users.github_id`), never a login, and it comes from a validated job, not from a request.
 */
export async function deleteSessionsByGithubId(db: Kysely<Database>, githubId: GithubId): Promise<number> {
  const result = await db
    .deleteFrom('sessions')
    .where('user_id', 'in', (eb) => eb.selectFrom('users').select('users.id').where('users.github_id', '=', githubId))
    .executeTakeFirstOrThrow();
  return Number(result.numDeletedRows);
}
