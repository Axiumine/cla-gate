// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { type VerifiedEmail, verifiedEmailsSchema } from '../../../shared/verified-email.ts';
import { isLive } from '../../domain/session.ts';
import type { Database } from './schema.ts';
import { hashSessionId, type LiveSession, timesOf } from './sessions-model.ts';
import { sessionWithUser, toSession } from './sessions-row.ts';

// Finding a session by its cookie value, keeping it alive and reading what was stored with it (E10-S01).

/** The live session for a cookie value; a dead row is deleted on the way and treated as absent. */
export async function findLiveSession(db: Kysely<Database>, id: string, now: Date): Promise<LiveSession | undefined> {
  const row = await sessionWithUser(db, hashSessionId(id));
  if (row === undefined) {
    return undefined;
  }
  const session = toSession(row);
  if (!isLive(timesOf(session), now.getTime())) {
    await db.deleteFrom('sessions').where('id', '=', session.rowId).execute();
    return undefined;
  }
  return session;
}

/** The verified addresses stored with a session; none for a session that is gone. */
export async function readVerifiedEmails(db: Kysely<Database>, rowId: number): Promise<readonly VerifiedEmail[]> {
  const row = await db.selectFrom('sessions').select('verified_emails').where('id', '=', rowId).executeTakeFirst();
  return verifiedEmailsSchema.parse(row?.verified_emails ?? []);
}

/** The domains of the verified addresses stored with a session (E21-S04), in the stored form; none for a session that is gone. */
export async function readVerifiedEmailDomains(db: Kysely<Database>, rowId: number): Promise<readonly string[]> {
  const row = await db
    .selectFrom('sessions')
    .select('verified_email_domains')
    .where('id', '=', rowId)
    .executeTakeFirst();
  return z.array(z.string()).parse(row?.verified_email_domains ?? []);
}
