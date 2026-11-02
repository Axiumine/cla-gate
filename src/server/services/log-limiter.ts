// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Clock } from './ports/clock.ts';

// "At most one log line per key per window" (E06-S05): a rejected tenant can send a delivery for every pull request it
// has, and one WARN per installation a minute is what an operator needs to see it, not a line per delivery. In memory,
// per process, keyed by a number (an installation id): nothing about a person or a request is kept.

export interface LogLimiter {
  /** True when `key` has not been let through in the last window, and records that it is now; false otherwise. */
  allow(key: number): boolean;
}

export interface LogLimiterOptions {
  readonly clock: Clock;
  /** How long a key is held back after it was let through. */
  readonly windowMs: number;
  /** The most keys remembered; past it the key let through longest ago is forgotten, so memory is bounded. */
  readonly maxKeys: number;
}

export function createLogLimiter(options: LogLimiterOptions): LogLimiter {
  // A `Map` keeps insertion order, and a key is re-inserted every time it is let through, so the first key is the oldest.
  const lastAllowedAt = new Map<number, number>();
  return {
    allow(key) {
      const now = options.clock.now().getTime();
      const last = lastAllowedAt.get(key);
      if (last !== undefined && now - last < options.windowMs) {
        return false;
      }
      lastAllowedAt.delete(key);
      lastAllowedAt.set(key, now);
      for (const oldest of lastAllowedAt.keys().take(Math.max(0, lastAllowedAt.size - options.maxKeys))) {
        lastAllowedAt.delete(oldest);
      }
      return true;
    },
  };
}
