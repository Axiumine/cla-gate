// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';
import type { Clock } from './ports/clock.ts';

// The share of an installation's GitHub budget that the public signature check may spend (E22-S02). A login that the memory of the
// check does not know is a `GET /users/{login}` on the installation token, in the rate-limit lane that the evaluation jobs of the same
// installation share, and anyone on the internet can ask about a login nobody has asked about before. The limits per client address
// and per repository bound one address and one repository; this one bounds the installation, however many addresses ask and whatever
// logins they make up, so the jobs that write the Check Runs always keep their room. Only a lookup that goes to GitHub counts: a login
// the memory knows is free. In-process on purpose, like the memory: one instance serves the server.

/**
 * How many logins the public check may look up at GitHub for one installation in a minute. GitHub gives an installation token 5,000
 * requests an hour at the least, and the platform's lane 900 points a minute; thirty a minute leaves the jobs nearly all of both.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const PUBLIC_LOOKUPS_PER_MINUTE = 30;

const WINDOW_MS = 60_000;

/** The most installations whose window is kept at once: far above the tenants of a server, and a bound all the same. */
const MAX_WINDOWS = 10_000;

interface Window {
  readonly startedAt: number;
  used: number;
}

/**
 * A count of lookups for each installation in a window of a minute that starts with the first lookup after the last window ended.
 * The time comes from the clock it is given, so a test moves it by hand. The key is the GitHub id of the installation, which
 * comes from the database and never from the request, so the map cannot be filled by a caller.
 */
export class LookupBudget {
  readonly #clock: Clock;
  readonly #perMinute: number;
  readonly #maxWindows: number;
  /** A `Map` iterates in insertion order, and a window is re-inserted when it starts, so the first key is the oldest window. */
  readonly #windows = new Map<GithubId, Window>();

  constructor(clock: Clock, options: { readonly perMinute?: number; readonly maxWindows?: number } = {}) {
    this.#clock = clock;
    this.#perMinute = options.perMinute ?? PUBLIC_LOOKUPS_PER_MINUTE;
    this.#maxWindows = options.maxWindows ?? MAX_WINDOWS;
  }

  /**
   * Spends one lookup of the installation.
   * @returns 0 when the lookup may be made, else the whole seconds (at least 1) until the window of the installation ends.
   */
  take(installation: GithubId): number {
    const now = this.#clock.now().getTime();
    const window = this.#windows.get(installation);
    if (window === undefined || now - window.startedAt >= WINDOW_MS) {
      this.#start(installation, now);
      return 0;
    }
    if (window.used >= this.#perMinute) {
      return Math.max(1, Math.ceil((window.startedAt + WINDOW_MS - now) / 1000));
    }
    window.used += 1;
    return 0;
  }

  #start(installation: GithubId, now: number): void {
    this.#windows.delete(installation);
    this.#windows.set(installation, { startedAt: now, used: 1 });
    for (const oldest of this.#windows.keys()) {
      if (this.#windows.size <= this.#maxWindows) {
        break;
      }
      this.#windows.delete(oldest);
    }
  }
}
