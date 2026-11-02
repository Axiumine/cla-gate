// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { GithubId } from '../../../shared/github-id.ts';
import type { Database } from './schema.ts';

// The people who logged in (E10-S05). A row is keyed on the numeric GitHub id; the rest is what the person looked like at the
// last login, a display snapshot that nothing keys on.

/** What a login learns about the person: the identity and the snapshot. */
export interface UserSnapshot {
  readonly githubId: GithubId;
  readonly login: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
}

/**
 * Creates the user or refreshes the snapshot of the one that exists, and returns `users.id`. Runs in the caller's
 * transaction when `db` is one: the login callback upserts the user, deletes the old session and inserts the new one together.
 */
export async function upsertUser(db: Kysely<Database>, user: UserSnapshot, now: Date): Promise<number> {
  const { id } = await db
    .insertInto('users')
    .values({
      github_id: user.githubId,
      login: user.login,
      name: user.name,
      avatar_url: user.avatarUrl,
      created_at: now,
      updated_at: now,
    })
    .onConflict((conflict) =>
      conflict.column('github_id').doUpdateSet((eb) => ({
        login: eb.ref('excluded.login'),
        name: eb.ref('excluded.name'),
        avatar_url: eb.ref('excluded.avatar_url'),
        updated_at: eb.ref('excluded.updated_at'),
      })),
    )
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}
