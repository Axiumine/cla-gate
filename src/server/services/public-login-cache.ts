// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';
import type { Clock } from './ports/clock.ts';

// The memory of the public signature check (E22-S02): which numeric GitHub id a login named on GitHub a moment ago, so that
// the same question asked again and again (a README badge, a CI step) costs one request to GitHub in ten minutes and not
// one for each. In-process on purpose: one instance serves the server. Nothing is keyed on a stored login and nothing is
// stored beyond the process: the entry is a lower-cased login and a number or its absence.

/**
 * How long an answer is remembered, a hit and a miss alike: ten minutes.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const LOGIN_CACHE_TTL_MS = 600_000;

/**
 * How many logins are remembered at most. The least recently used one goes first.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const LOGIN_CACHE_MAX_ENTRIES = 10_000;

/**
 * What GitHub said about a login: the numeric id of the account, or `null` for a login that no account has. An absent answer
 * (the cache has nothing, or the entry is too old) is `undefined`, which is not the same thing.
 */
export type LoginAnswer = GithubId | null;

interface Entry {
  readonly answer: LoginAnswer;
  /** Milliseconds since the epoch at which the entry stops counting. */
  readonly expiresAt: number;
}

/** The key of a login: GitHub compares logins without regard to case, so `OctoCat` and `octocat` are one entry. */
const keyOf = (login: string): string => login.toLowerCase();

/**
 * A map of at most `maxEntries` logins that remembers each answer for `ttlMs` from the moment it was stored. A read of a live
 * entry makes it the most recently used one; a read of an expired entry removes it and finds nothing. The time comes from the
 * clock it is given, so a test moves it by hand.
 */
export class LoginCache {
  readonly #clock: Clock;
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  /** A `Map` iterates in insertion order, so the first key is the least recently used one: a read re-inserts its key at the end. */
  readonly #entries = new Map<string, Entry>();

  constructor(clock: Clock, options: { readonly ttlMs?: number; readonly maxEntries?: number } = {}) {
    this.#clock = clock;
    this.#ttlMs = options.ttlMs ?? LOGIN_CACHE_TTL_MS;
    this.#maxEntries = options.maxEntries ?? LOGIN_CACHE_MAX_ENTRIES;
  }

  /** The answer remembered for `login`, `null` for a login GitHub said nobody has, or `undefined` when nothing live is remembered. */
  get(login: string): LoginAnswer | undefined {
    const key = keyOf(login);
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    this.#entries.delete(key);
    if (entry.expiresAt <= this.#clock.now().getTime()) {
      return undefined;
    }
    this.#entries.set(key, entry);
    return entry.answer;
  }

  /** Remembers `answer` for `login`, as the most recently used entry, and drops the least recently used ones past the limit. */
  set(login: string, answer: LoginAnswer): void {
    const key = keyOf(login);
    this.#entries.delete(key);
    this.#entries.set(key, { answer, expiresAt: this.#clock.now().getTime() + this.#ttlMs });
    for (const oldest of this.#entries.keys()) {
      if (this.#entries.size <= this.#maxEntries) {
        break;
      }
      this.#entries.delete(oldest);
    }
  }
}
