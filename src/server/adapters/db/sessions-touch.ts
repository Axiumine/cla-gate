// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { needsTouch, type SessionLimits, slide } from '../../domain/session.ts';
import type { Database } from './schema.ts';
import { type LiveSession, timesOf } from './sessions-model.ts';

// Keeping a session alive while it is used (E10-S01).

/** Moves `last_seen_at` and the idle expiry forward, but only when the session was last seen more than 60 seconds ago. */
export async function touchSession(
  db: Kysely<Database>,
  limits: SessionLimits,
  session: LiveSession,
  now: Date,
): Promise<LiveSession> {
  if (!needsTouch(session.lastSeenAt.getTime(), now.getTime())) {
    return session;
  }
  const idleExpiresAt = new Date(slide(timesOf(session), now.getTime(), limits).idleExpiresAt);
  await db
    .updateTable('sessions')
    .set({ last_seen_at: now, idle_expires_at: idleExpiresAt })
    .where('id', '=', session.rowId)
    .execute();
  return { ...session, lastSeenAt: now, idleExpiresAt };
}
