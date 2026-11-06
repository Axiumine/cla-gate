// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../../../src/server/adapters/db/schema.ts';
import { insertRow, sessionHashOf } from './insert.ts';
import type { Person } from './people.ts';

// E18-S12: a person and their session as rows. The session is what the login would have written, so the browser needs no
// OAuth round trip and the application makes no call to GitHub.

/** The idle and the absolute life of a seeded session. Both are in the future of any run, and the first is not past the second. */
const IDLE_HOURS = 6;
const ABSOLUTE_HOURS = 12;

const HOUR_MS = 3_600_000;

/** Writes the person's `users` row once; a second call changes nothing. */
export async function ensureUser(db: Kysely<Database>, person: Person): Promise<void> {
  const known = await db.selectFrom('users').select('id').where('github_id', '=', person.githubId).executeTakeFirst();
  if (known === undefined) {
    await insertRow(db, 'users', {
      id: person.rowId,
      github_id: person.githubId,
      login: person.login,
      name: person.name,
      avatar_url: null,
    });
  }
}

/**
 * Gives the person one live session whose cookie value is `person.cookie`, and the verified addresses they have. A session of
 * the same cookie that an earlier run left is replaced, so its lifetime starts at this run.
 */
export async function ensureSession(db: Kysely<Database>, person: Person, now: Date): Promise<void> {
  await db.deleteFrom('sessions').where('session_hash', '=', sessionHashOf(person.cookie)).execute();
  const user = await db
    .selectFrom('users')
    .select('id')
    .where('github_id', '=', person.githubId)
    .executeTakeFirstOrThrow();
  await insertRow(db, 'sessions', {
    session_hash: sessionHashOf(person.cookie),
    user_id: user.id,
    csrf_secret: sessionHashOf(`csrf:${person.cookie}`).slice(0, 43),
    created_at: now,
    last_seen_at: now,
    idle_expires_at: new Date(now.getTime() + IDLE_HOURS * HOUR_MS),
    absolute_expires_at: new Date(now.getTime() + ABSOLUTE_HOURS * HOUR_MS),
    verified_emails: JSON.stringify(person.emails),
  });
}

/** The `users.id` of a person already written, as the database holds it. */
export async function rowIdOf(db: Kysely<Database>, person: Person): Promise<number> {
  const row = await db
    .selectFrom('users')
    .select('id')
    .where('github_id', '=', person.githubId)
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Whether the schema the specs run on has the tables of the application, so a wrong DATABASE_URL fails with a sentence and not a stack. */
export async function assertMigrated(db: Kysely<Database>): Promise<void> {
  const found = await sql<{ found: boolean }>`select to_regclass('installations') is not null as found`.execute(db);
  if (found.rows[0]?.found !== true) {
    throw new Error('DATABASE_URL names a database without the tables of the application: run yarn db:migrate first');
  }
}
