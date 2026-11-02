// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The lifetime rules of a session (E10-S01), pure. Time is a number of milliseconds since the epoch, because this
// layer has no clock and no `Date`: the caller reads its clock once and passes the instant in, and the session store
// converts to and from the database's timestamps. Nothing here knows about cookies, users or tenants.

const MS_PER_SECOND = 1000;

/** A session's last-seen time is refreshed at most this often, so a busy page does not write on every request. */
const TOUCH_INTERVAL_MS = 60_000;

/** The configured lifetimes in seconds. `idleSeconds` is never above `absoluteSeconds` (`loadConfig` enforces it). */
export interface SessionLimits {
  readonly idleSeconds: number;
  readonly absoluteSeconds: number;
}

/** When a session dies, in milliseconds since the epoch; `idleExpiresAt <= absoluteExpiresAt` always, as the table checks. */
export interface SessionTimes {
  /** Dead from this instant on if nobody used it before; moves forward with use ({@link slide}). */
  readonly idleExpiresAt: number;
  /** Dead from this instant on whatever happens; fixed at login. */
  readonly absoluteExpiresAt: number;
}

/** The two expiry times of a session created at `now`. */
export function newTimes(now: number, limits: SessionLimits): SessionTimes {
  return {
    idleExpiresAt: now + limits.idleSeconds * MS_PER_SECOND,
    absoluteExpiresAt: now + limits.absoluteSeconds * MS_PER_SECOND,
  };
}

/** A session is dead at `idleExpiresAt <= now` or `absoluteExpiresAt <= now`: the expiry instant itself is already too late. */
export function isLive(times: SessionTimes, now: number): boolean {
  return times.idleExpiresAt > now && times.absoluteExpiresAt > now;
}

/**
 * The times after use at `now`: the idle expiry moves to `now + idle`, but never past the absolute expiry, so the
 * table's `idle_expires_at <= absolute_expires_at` check always holds. The absolute expiry never moves.
 */
export function slide(times: SessionTimes, now: number, limits: SessionLimits): SessionTimes {
  return {
    idleExpiresAt: Math.min(now + limits.idleSeconds * MS_PER_SECOND, times.absoluteExpiresAt),
    absoluteExpiresAt: times.absoluteExpiresAt,
  };
}

/** Whether a session last seen at `lastSeenAt` is due a refresh: strictly more than {@link TOUCH_INTERVAL_MS} ago. */
export function needsTouch(lastSeenAt: number, now: number): boolean {
  return now - lastSeenAt > TOUCH_INTERVAL_MS;
}
