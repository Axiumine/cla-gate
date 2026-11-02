// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { LoginFailureReason } from '../../shared/auth.ts';
import type { Database } from '../adapters/db/schema.ts';
import { type CreatedSession, createSessionStore } from '../adapters/db/sessions.ts';
import { withTransaction } from '../adapters/db/transaction.ts';
import { upsertUser } from '../adapters/db/users.ts';
import type { Secret } from '../config/secret.ts';
import type { SessionLimits } from '../domain/session.ts';
import type { Clock } from './ports/clock.ts';
import { type GithubLogin, type GithubLoginProfile, LoginFailure } from './ports/github-login.ts';

// Completing a login (E10-S05): the code becomes a token, the token becomes an identity, the token is revoked, and the
// identity becomes a user row and a brand-new session. The token lives in `identify` and nowhere else.

/** The part of a logger the login uses: a warning with plain fields. */
interface LoginLog {
  warn(fields: object, message: string): void;
}

export interface LoginContext {
  readonly db: Kysely<Database>;
  readonly github: GithubLogin;
  readonly limits: SessionLimits;
  readonly clock: Clock;
  readonly log: LoginLog;
}

export interface LoginAttempt {
  /** The `code` GitHub put on the callback. */
  readonly code: string;
  /** The PKCE verifier from the attempt cookie. */
  readonly verifier: string;
  /** `sessions.id` of the session the browser presented on the callback, if any: it ends with this login (session fixation). */
  readonly presentedSessionRowId: number | undefined;
}

interface Failed {
  readonly ok: false;
  readonly reason: LoginFailureReason;
}

/** How a login ended: a new session (the plain id is for the cookie only) or the reason it failed. */
export type LoginResult = { readonly ok: true; readonly session: CreatedSession } | Failed;

/** A failure of a GitHub call becomes a reason; anything else is a bug and goes on up. */
function refusal(error: unknown): Failed {
  if (error instanceof LoginFailure) {
    return { ok: false, reason: error.reason };
  }
  throw error;
}

/** Best-effort: the token is useless after the identity is read, so GitHub is asked to forget it; a failure is a warning with the status. */
async function discard(context: LoginContext, token: Secret): Promise<void> {
  const result = await context.github.revoke(token);
  if (!result.ok) {
    context.log.warn({ status: result.status }, 'auth.token_revoke_failed');
  }
}

/** The code, the token, the identity and the revocation. The token is revoked on every path that obtained one. */
async function identify(
  context: LoginContext,
  attempt: LoginAttempt,
): Promise<{ readonly ok: true; readonly profile: GithubLoginProfile } | Failed> {
  let token: Secret;
  try {
    token = await context.github.exchange(attempt.code, attempt.verifier);
  } catch (error) {
    return refusal(error);
  }
  try {
    return { ok: true, profile: await context.github.identity(token) };
  } catch (error) {
    return refusal(error);
  } finally {
    await discard(context, token);
  }
}

/**
 * The user, the end of the presented session and the new session in one transaction, so a failure writes nothing. The new
 * id is generated here, never taken from the request.
 */
function persist(
  context: LoginContext,
  profile: GithubLoginProfile,
  presented: number | undefined,
): Promise<CreatedSession> {
  const now = context.clock.now();
  return withTransaction(context.db, async (trx) => {
    const userId = await upsertUser(trx, profile, now);
    const sessions = createSessionStore(trx, context.limits);
    if (presented !== undefined) {
      await sessions.remove(presented);
    }
    return sessions.create({ userId, verifiedEmails: profile.verifiedEmails }, now);
  });
}

/**
 * Turns a callback's code into a session. The user is created or refreshed by numeric GitHub id; the session carries the
 * verified addresses of this login, because no token is kept to read them later.
 */
export async function completeLogin(context: LoginContext, attempt: LoginAttempt): Promise<LoginResult> {
  const identified = await identify(context, attempt);
  if (!identified.ok) {
    return identified;
  }
  return { ok: true, session: await persist(context, identified.profile, attempt.presentedSessionRowId) };
}
