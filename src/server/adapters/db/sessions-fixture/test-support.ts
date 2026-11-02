// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { SessionLimits } from '../../../domain/session.ts';
import type { Database } from '../schema.ts';
import { createSessionStore, type SessionStore } from '../sessions.ts';
import { migratedRuntimeDatabase, migratedTestDatabase } from '../test-support.ts';

// Fixtures of the session store tests (E10-S01): users, a fixed clock and rows written by hand, so that a test can put
// a session in any state, including the ones `create` never produces (an expired one).

export const LIMITS: SessionLimits = { idleSeconds: 28_800, absoluteSeconds: 604_800 };

/** The instant the tests start at; `after(ms)` moves from it. The database clock is never consulted. */
export const T0 = new Date('2026-11-02T10:00:00.000Z');
export const SECOND = 1000;
export const HOUR = 3600 * SECOND;
export const after = (milliseconds: number): Date => new Date(T0.getTime() + milliseconds);

/** The value, or a failure that says the test's setup did not produce it (narrows `T | undefined` without an assertion). */
export function present<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('expected a value, got undefined');
  }
  return value;
}

export const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

async function insertUser(db: Kysely<Database>, githubId: number): Promise<number> {
  const user = await db
    .insertInto('users')
    .values({ github_id: githubId, login: `login-${githubId}`, name: `Name ${githubId}`, avatar_url: null })
    .returning('id')
    .executeTakeFirstOrThrow();
  return user.id;
}

/** The GitHub ids of the two people of a {@link SessionsWorld}; `alice` and `bob` are their internal `users.id`. */
export const ALICE_GITHUB_ID = 1001;
export const BOB_GITHUB_ID = 2002;

export interface SessionsWorld {
  readonly db: Kysely<Database>;
  readonly store: SessionStore;
  /** `users.id` of two people. */
  readonly alice: number;
  readonly bob: number;
}

async function worldOver(db: Kysely<Database>): Promise<SessionsWorld> {
  return {
    db,
    store: createSessionStore(db, LIMITS),
    alice: await insertUser(db, ALICE_GITHUB_ID),
    bob: await insertUser(db, BOB_GITHUB_ID),
  };
}

/** A migrated database with two users and a store over it. */
export async function sessionsWorld(): Promise<SessionsWorld> {
  return worldOver((await migratedTestDatabase()).db);
}

/** {@link sessionsWorld} on a database where the runtime role `cla_app` exists and holds its grants. */
export async function runtimeSessionsWorld(): Promise<SessionsWorld> {
  return worldOver((await migratedRuntimeDatabase()).db);
}

/** Writes a session row by hand. `seed` makes the hash unique; the times are the state the test wants. */
export async function insertSessionRow(
  db: Kysely<Database>,
  userId: number,
  seed: number,
  times: { createdAt: Date; idleExpiresAt: Date; absoluteExpiresAt: Date },
): Promise<number> {
  const row = await db
    .insertInto('sessions')
    .values({
      session_hash: sha256Hex(`seed-${seed}`),
      user_id: userId,
      csrf_secret: `csrf-${seed}`,
      created_at: times.createdAt,
      last_seen_at: times.createdAt,
      idle_expires_at: times.idleExpiresAt,
      absolute_expires_at: times.absoluteExpiresAt,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** A session row that is dead at `T0`: idle and absolute expiry in the past. */
export function insertExpiredRow(db: Kysely<Database>, userId: number, seed: number): Promise<number> {
  return insertSessionRow(db, userId, seed, {
    createdAt: after(-2 * HOUR),
    idleExpiresAt: after(-HOUR),
    absoluteExpiresAt: after(-HOUR),
  });
}

/** The ids of the sessions of a user, oldest first. */
export async function sessionIdsOf(db: Kysely<Database>, userId: number): Promise<number[]> {
  const rows = await db
    .selectFrom('sessions')
    .select('id')
    .where('user_id', '=', userId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  return rows.map((row) => row.id);
}

export async function countSessions(db: Kysely<Database>): Promise<number> {
  const row = await db
    .selectFrom('sessions')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .executeTakeFirstOrThrow();
  return row.n;
}
