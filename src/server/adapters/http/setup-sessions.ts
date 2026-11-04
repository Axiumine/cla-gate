// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { randomBytes } from 'node:crypto';
import type { Clock } from '../../services/ports/clock.ts';

// The sessions of the first-run setup (E19-S06): what an unlock opens and the cookie names. In memory only, in this process,
// so a restart ends them all, and nothing about them is ever written down or logged. There is no database behind the setup
// (no actor exists before the App does), and at most three people can be unlocked at once. The one fact that is not about a
// session, that the credentials of an App were handed out (E19-S11), is kept here too and ends with the process.

/**
 * Thirty minutes without a request ends a session.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const SETUP_IDLE_MS = 1_800_000;

/**
 * At most this many sessions are alive; the next unlock ends the one used longest ago.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const SETUP_MAX_SESSIONS = 3;

/** 32 random bytes as base64url: the id of a session, its CSRF token and the `state` of a manifest are 43 characters each. */
function randomValue(): string {
  return randomBytes(32).toString('base64url');
}

/** One unlocked session. Only the store changes it. */
export interface SetupSession {
  /** The value of the cookie. */
  readonly id: string;
  /** What every setup `POST` besides the unlock presents in `x-csrf-token`. */
  readonly csrfToken: string;
  /** The `state` of the manifest issued last to this session and not yet used, or undefined before the first one and after it was used (E19-S11). */
  state: string | undefined;
  /** When the session was last used, in milliseconds since the epoch. */
  seenAt: number;
}

export interface SetupSessions {
  /** Opens a session with a new id and CSRF token, ending the one used longest ago when three are alive. */
  open(): SetupSession;
  /** The live session with this id, or undefined: an id never issued, a session that has been idle too long, or one that was pushed out. */
  find(id: string | undefined): SetupSession | undefined;
  /** Starts the idle time of `session` over. */
  renew(session: SetupSession): void;
  /** Gives `session` a new `state`, replacing the one it had: only the last manifest issued can be completed. */
  issueState(session: SetupSession): string;
  /**
   * Uses the `state` of `session` up (E19-S11). A conversion calls it before it asks GitHub, so that a second request that
   * arrives while the first waits finds nothing to complete: the credentials of one manifest are issued once.
   */
  consumeState(session: SetupSession): void;
  /**
   * Gives `state` back to `session` after a conversion that reached no verdict of GitHub's (an outage), so the same page can
   * try again. A manifest issued meanwhile has replaced it, and the newer `state` stays.
   */
  restoreState(session: SetupSession, state: string): void;
  /** Whether this process has handed out the credentials of an App (E19-S11). It stays so until the process restarts, whichever session asks. */
  readonly credentialsIssued: boolean;
  /** Records that the credentials of an App were handed out: the manifest and the conversion answer `409` from now on. */
  markCredentialsIssued(): void;
}

/** A new `state` for `session`, replacing the one it had. */
function issueState(session: SetupSession): string {
  session.state = randomValue();
  return session.state;
}

/** Empties the `state` of `session`. */
function consumeState(session: SetupSession): void {
  session.state = undefined;
}

/** Puts `state` back into `session` unless it holds one by now. */
function restoreState(session: SetupSession, state: string): void {
  session.state ??= state;
}

/** An empty store on `clock`. */
export function createSetupSessions(clock: Clock): SetupSessions {
  // A `Map` keeps insertion order and a session is moved to the back whenever it is used, so the first entry is the one used longest ago.
  const live = new Map<string, SetupSession>();
  let credentialsIssued = false;
  const nowMs = (): number => clock.now().getTime();

  /** Forgets the sessions that have been idle too long. They are in order of use, so the first live one ends the walk. */
  function dropIdle(): void {
    for (const session of live.values()) {
      if (nowMs() - session.seenAt <= SETUP_IDLE_MS) {
        return;
      }
      live.delete(session.id);
    }
  }

  return {
    open() {
      dropIdle();
      for (const oldest of live.keys().take(Math.max(0, live.size - (SETUP_MAX_SESSIONS - 1)))) {
        live.delete(oldest);
      }
      const session: SetupSession = { id: randomValue(), csrfToken: randomValue(), state: undefined, seenAt: nowMs() };
      live.set(session.id, session);
      return session;
    },
    find(id) {
      dropIdle();
      return id === undefined ? undefined : live.get(id);
    },
    renew(session) {
      session.seenAt = nowMs();
      live.delete(session.id);
      live.set(session.id, session);
    },
    issueState,
    consumeState,
    restoreState,
    get credentialsIssued() {
      return credentialsIssued;
    },
    markCredentialsIssued() {
      credentialsIssued = true;
    },
  };
}
