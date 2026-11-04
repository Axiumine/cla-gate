// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { messageOf } from '../ci/lib/errors.ts';

// E19-S12: waiting for a stack to do something, and timing how long a command takes. The clock is a parameter, so that the
// unit tests run in no time and the scenarios use the real one (system.ts).

export interface Clock {
  /** Milliseconds on a clock that only goes forward. */
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

const INTERVAL_MS = 500;

/**
 * Calls `probe` until it answers something other than `undefined`, then returns that. A probe that throws (a refused
 * connection while a service is down) has not succeeded yet. When `timeoutMs` have passed the error says what was waited for
 * and, if the probe threw, why the last try failed.
 */
export async function eventually<T>(
  clock: Clock,
  what: string,
  timeoutMs: number,
  probe: () => Promise<T | undefined>,
): Promise<T> {
  const deadline = clock.now() + timeoutMs;
  for (;;) {
    let reason: string;
    try {
      const value = await probe();
      if (value !== undefined) {
        return value;
      }
      reason = '';
    } catch (error) {
      reason = `: ${messageOf(error)}`;
    }
    if (clock.now() >= deadline) {
      throw new Error(`${what} did not happen within ${timeoutMs} ms${reason}`);
    }
    await clock.sleep(INTERVAL_MS);
  }
}

/** What `run` returned and the milliseconds it took. */
export async function timed<T>(
  clock: Clock,
  run: () => Promise<T>,
): Promise<{ readonly value: T; readonly ms: number }> {
  const start = clock.now();
  const value = await run();
  return { value, ms: clock.now() - start };
}
