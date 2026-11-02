// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createHash, randomBytes } from 'node:crypto';
import type { GithubId } from '../../../shared/github-id.ts';
import type { VerifiedEmail } from '../../../shared/verified-email.ts';

// The shapes of the session store (E10-S01) and the two functions on the id that every part of it shares.

/** A person has at most this many sessions at once; creating one more deletes the oldest. */
export const MAX_SESSIONS_PER_USER = 10;
/** Each creation deletes at most this many expired sessions, so the table needs no scheduler to stay small. */
export const PURGE_BATCH = 100;

/** The session row of a person, for the first request that proves it with the cookie. */
export interface SessionUser {
  /** `users.id`, the internal key that foreign keys such as `published_by` and `created_by` use. */
  readonly id: number;
  /** The identity: the numeric GitHub id. Login, name and avatar are display snapshots; nothing keys on them. */
  readonly githubId: GithubId;
  readonly login: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
}

/** A session that has not expired, with the person it belongs to. */
export interface LiveSession {
  /** `sessions.id`: the handle of this session in logout and in the verified-address lookup. Not the cookie value. */
  readonly rowId: number;
  readonly user: SessionUser;
  /** The per-session secret the CSRF token derives from (E10-S03). */
  readonly csrfSecret: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

export interface NewSession {
  /** `users.id` of the person who just logged in. */
  readonly userId: number;
  /** The verified addresses captured at login, at most 20; they live exactly as long as the row. */
  readonly verifiedEmails?: readonly VerifiedEmail[];
}

/** What `create` hands back: the only place the plain id appears besides the cookie. */
export interface CreatedSession {
  /** The plain session id (43 characters of base64url): goes into the cookie and nowhere else. */
  readonly id: string;
  readonly rowId: number;
  readonly csrfSecret: string;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

export interface SessionStore {
  /**
   * Stores a session for `input.userId` and deletes, in the same statement, the person's oldest live session when this
   * would be the 11th and up to 100 sessions that have expired. Runs in the caller's transaction or in one of its own.
   */
  create(input: NewSession, now: Date): Promise<CreatedSession>;
  /** The session for a cookie value, or undefined when there is none or it is dead (a dead row is deleted). */
  findLive(id: string, now: Date): Promise<LiveSession | undefined>;
  /** Moves the idle expiry forward when the session was last seen more than 60 seconds ago; else changes nothing. */
  touch(session: LiveSession, now: Date): Promise<LiveSession>;
  /** The verified addresses stored with the session at login (for the signing page, E13). */
  verifiedEmails(rowId: number): Promise<readonly VerifiedEmail[]>;
  /** Deletes the session with this `sessions.id`; the login callback ends the session it was presented with (E10-S05). */
  remove(rowId: number): Promise<void>;
  /** Deletes every session of the user with this `users.id` and returns the count; logout everywhere (E10-S06). */
  removeAllOfUser(userId: number): Promise<number>;
  /**
   * Deletes every session of the person with this numeric GitHub id and returns the count; the `users` row stays and
   * nothing else is touched. Used when the person revokes the App authorization (E10-S07).
   */
  removeAllOfGithubId(githubId: GithubId): Promise<number>;
}

/** The id and the CSRF secret are 32 random bytes, 43 characters in base64url. */
const TOKEN_BYTES = 32;

/** A new random id or CSRF secret. */
export const newToken = (): string => randomBytes(TOKEN_BYTES).toString('base64url');

/** The value of `sessions.session_hash` for a session id. */
export const hashSessionId = (id: string): string => createHash('sha256').update(id, 'utf8').digest('hex');

/** The expiry times of a session in the milliseconds the domain rules work with. */
export const timesOf = (session: Pick<LiveSession, 'idleExpiresAt' | 'absoluteExpiresAt'>) => ({
  idleExpiresAt: session.idleExpiresAt.getTime(),
  absoluteExpiresAt: session.absoluteExpiresAt.getTime(),
});
