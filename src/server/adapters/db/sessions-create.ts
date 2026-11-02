// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Insertable, type Kysely, sql, type Transaction } from 'kysely';
import { newTimes, type SessionLimits } from '../../domain/session.ts';
import type { Database } from './schema.ts';
import {
  type CreatedSession,
  hashSessionId,
  MAX_SESSIONS_PER_USER,
  type NewSession,
  newToken,
  PURGE_BATCH,
} from './sessions-model.ts';
import { withTransaction } from './transaction.ts';

// Creating a session (E10-S01): one insert that also enforces the cap of 10 per person and purges the expired.

/**
 * One person creates one session at a time: the cap counts the sessions the statement can see, and two creations that
 * ran side by side would both see nine and both insert. The lock is taken in an earlier statement of the transaction,
 * so the statement that counts starts after the other transaction has committed.
 */
async function lockUserSessions(trx: Transaction<Database>, userId: number): Promise<void> {
  const name = `session-user:${userId}`;
  await sql`select pg_advisory_xact_lock(hashtextextended(${name}, 0))`.execute(trx);
}

/**
 * One statement: delete the expired sessions (a batch) and the person's live sessions beyond the newest nine, insert the
 * new one. Everything in it sees the same snapshot, and it succeeds or fails as a whole, so a failing insert (a check
 * violated) deletes nothing. A session whose absolute expiry has passed has an idle expiry that has passed too (the
 * table's check), so `idle_expires_at <= now` finds both kinds.
 */
function insertWithEviction(trx: Transaction<Database>, row: Insertable<Database['sessions']>, now: Date) {
  return trx
    .with('expired', (qb) =>
      qb.selectFrom('sessions').select('id').where('idle_expires_at', '<=', now).orderBy('id').limit(PURGE_BATCH),
    )
    .with('surplus', (qb) =>
      qb
        .selectFrom('sessions')
        .select('id')
        .where('user_id', '=', row.user_id)
        .where('idle_expires_at', '>', now)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .offset(MAX_SESSIONS_PER_USER - 1),
    )
    .with('removed', (qb) =>
      qb
        .deleteFrom('sessions')
        .where((eb) =>
          eb.or([
            eb('id', 'in', eb.selectFrom('expired').select('id')),
            eb('id', 'in', eb.selectFrom('surplus').select('id')),
          ]),
        ),
    )
    .insertInto('sessions')
    .values(row)
    .returning('id')
    .executeTakeFirstOrThrow();
}

/**
 * Stores a session for `input.userId` and returns it with the plain id, which exists nowhere else. Runs in the caller's
 * transaction when `db` is one, else in a transaction of its own.
 */
export async function createSession(
  db: Kysely<Database>,
  limits: SessionLimits,
  input: NewSession,
  now: Date,
): Promise<CreatedSession> {
  const id = newToken();
  const csrfSecret = newToken();
  const times = newTimes(now.getTime(), limits);
  const idleExpiresAt = new Date(times.idleExpiresAt);
  const absoluteExpiresAt = new Date(times.absoluteExpiresAt);
  const row = {
    session_hash: hashSessionId(id),
    user_id: input.userId,
    csrf_secret: csrfSecret,
    created_at: now,
    last_seen_at: now,
    idle_expires_at: idleExpiresAt,
    absolute_expires_at: absoluteExpiresAt,
    verified_emails: JSON.stringify(input.verifiedEmails ?? []),
  };
  const { id: rowId } = await withTransaction(db, async (trx) => {
    await lockUserSessions(trx, input.userId);
    return insertWithEviction(trx, row, now);
  });
  return { id, rowId, csrfSecret, idleExpiresAt, absoluteExpiresAt };
}
