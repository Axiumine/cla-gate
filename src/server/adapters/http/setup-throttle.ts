// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createFailureThrottle, type FailureThrottle } from '../../services/failure-throttle.ts';
import type { Clock } from '../../services/ports/clock.ts';

// The limit on wrong setup tokens (E19-S06): five failures per minute from one client address and thirty per ten minutes from
// all of them together. The token is the only thing that stands between the internet and the creation of the App, so a
// guess costs time: past the limit every unlock answers `429` with `Retry-After`, the right token included, until the oldest
// failure of the window has slid out. Only failures are counted, so the operator's own successful unlock moves nothing.

/**
 * The failures allowed in a window, per client address and for the whole server.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const UNLOCK_LIMITS = {
  perAddress: { failures: 5, windowMs: 60_000 },
  overall: { failures: 30, windowMs: 600_000 },
} as const;

/** The most client addresses remembered; past it the one that failed longest ago is forgotten, so memory is bounded. */
const MAX_ADDRESSES = 10_000;

/** The key of the one counter that every address shares. */
const EVERYONE = 'everyone';

export interface UnlockThrottle {
  /** Whole seconds until `address` may try again, or undefined while it may: the longer of its own wait and the server's. */
  retryAfter(address: string): number | undefined;
  /** Counts one wrong token from `address`. */
  recordFailure(address: string): void;
}

/** A throttle that holds a key back after `failures` failures in the window (the shared one holds back after *more than* its count). */
function limit(
  clock: Clock,
  window: { readonly failures: number; readonly windowMs: number },
  maxKeys: number,
): FailureThrottle {
  return createFailureThrottle({ clock, maxFailures: window.failures - 1, windowMs: window.windowMs, maxKeys });
}

/** The two counters of {@link UNLOCK_LIMITS} on `clock`. */
export function createUnlockThrottle(clock: Clock): UnlockThrottle {
  const perAddress = limit(clock, UNLOCK_LIMITS.perAddress, MAX_ADDRESSES);
  const overall = limit(clock, UNLOCK_LIMITS.overall, 1);
  return {
    retryAfter(address) {
      const waits = [perAddress.retryAfter(address), overall.retryAfter(EVERYONE)].filter((wait) => wait !== undefined);
      return waits.length === 0 ? undefined : Math.max(...waits);
    },
    recordFailure(address) {
      perAddress.recordFailure(address);
      overall.recordFailure(EVERYONE);
    },
  };
}
