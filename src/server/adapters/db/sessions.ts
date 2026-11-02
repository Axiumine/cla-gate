// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { SessionLimits } from '../../domain/session.ts';
import type { Database } from './schema.ts';
import { createSession } from './sessions-create.ts';
import type { SessionStore } from './sessions-model.ts';
import { findLiveSession, readVerifiedEmails } from './sessions-read.ts';
import { touchSession } from './sessions-touch.ts';

// The server-side session store (E10-S01). A session is a row of `sessions`, found by the SHA-256 of a 256-bit random
// id: the id exists in the cookie and in the return value of `create`, the table holds only its hash, so a copy of the
// table (a backup, a SQL injection that reads) cannot be turned into a login. Time comes in as a parameter, never from
// the database clock, so a test moves it by hand. No GitHub user token is stored anywhere (E10-S05).

export {
  type CreatedSession,
  type LiveSession,
  MAX_SESSIONS_PER_USER,
  type NewSession,
  PURGE_BATCH,
  type SessionStore,
  type SessionUser,
} from './sessions-model.ts';

/**
 * The session store over `db`, which may be a transaction: the login callback creates its session in the same
 * transaction as the user upsert (E10-S05). `limits` are the configured lifetimes.
 */
export function createSessionStore(db: Kysely<Database>, limits: SessionLimits): SessionStore {
  return {
    create: (input, now) => createSession(db, limits, input, now),
    findLive: (id, now) => findLiveSession(db, id, now),
    touch: (session, now) => touchSession(db, limits, session, now),
    verifiedEmails: (rowId) => readVerifiedEmails(db, rowId),
  };
}
