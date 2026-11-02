// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Clock } from './ports/clock.ts';

// "More than N failures from one client within a window" (E06-S07): the failed-signature throttle of the webhook route.
// In memory, per process, keyed by the client address the caller hands over. Only failures are recorded, so a burst of
// valid deliveries never moves a counter. What is kept is the times of the last failures of each address and nothing
// else; the key is held for the throttle's own use and is never logged or written anywhere.

/** The limits of the webhook route's throttle: more than 30 failed verifications from one address within 60 seconds. */
export const SIGNATURE_FAILURE_LIMITS = { maxFailures: 30, windowMs: 60_000, maxKeys: 10_000 } as const;

export interface FailureThrottle {
  /** Whole seconds until `key` may be served again, or `undefined` while it is not held back. Does not record anything. */
  retryAfter(key: string): number | undefined;
  /** Records one failure of `key` now. Returns what {@link retryAfter} would: the wait when this failure leaves `key` over the limit. */
  recordFailure(key: string): number | undefined;
}

export interface FailureThrottleOptions {
  readonly clock: Clock;
  /** A key is held back once it has failed more than this many times within `windowMs`. */
  readonly maxFailures: number;
  readonly windowMs: number;
  /** The most keys remembered; past it the key used longest ago is forgotten, so memory is bounded. */
  readonly maxKeys: number;
}

/**
 * `times` are the last `maxFailures + 1` failures of one key, oldest first. The key is over the limit while all of them
 * are inside the window, that is while the oldest of them is; it is free again when that one slides out.
 */
function waitFor(times: readonly number[], now: number, options: FailureThrottleOptions): number | undefined {
  const oldest = times[0];
  if (oldest === undefined || times.length <= options.maxFailures) {
    return undefined;
  }
  const remaining = oldest + options.windowMs - now;
  return remaining > 0 ? Math.ceil(remaining / 1000) : undefined;
}

export function createFailureThrottle(options: FailureThrottleOptions): FailureThrottle {
  // A `Map` keeps insertion order and a key is re-inserted every time it is used, so the first key is the least recently used.
  const failures = new Map<string, number[]>();
  const nowMs = (): number => options.clock.now().getTime();

  /** Moves `key` to the back of the line and returns its failures, or `undefined` for a key never seen. */
  function touch(key: string): number[] | undefined {
    const times = failures.get(key);
    if (times !== undefined) {
      failures.delete(key);
      failures.set(key, times);
    }
    return times;
  }

  return {
    retryAfter(key) {
      const times = touch(key);
      return times === undefined ? undefined : waitFor(times, nowMs(), options);
    },
    recordFailure(key) {
      const now = nowMs();
      const times = touch(key) ?? [];
      times.push(now);
      times.splice(0, Math.max(0, times.length - (options.maxFailures + 1)));
      failures.set(key, times);
      for (const oldest of failures.keys().take(Math.max(0, failures.size - options.maxKeys))) {
        failures.delete(oldest);
      }
      return waitFor(times, now, options);
    },
  };
}
