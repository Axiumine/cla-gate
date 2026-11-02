// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { RoleKey } from './role-key.ts';

// The answers a role cache keeps (E11-S04): booleans with the time they stop being served, at most a fixed number of them,
// the one used longest ago forgotten first.

/** One kept answer: `expiresAt` is when it stops being served, in milliseconds since the epoch. */
export interface RoleEntry {
  readonly key: RoleKey;
  readonly allowed: boolean;
  readonly expiresAt: number;
}

export class RoleEntries {
  readonly #maxEntries: number;
  // A `Map` keeps insertion order and an entry is re-inserted every time it is used, so the first one is the least recently used.
  readonly #entries = new Map<string, RoleEntry>();

  /** @throws RangeError when `maxEntries` is not a positive integer. */
  constructor(maxEntries: number) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError('a role cache keeps a positive number of entries');
    }
    this.#maxEntries = maxEntries;
  }

  /** How many answers are kept (an answer past its time counts until it is looked up or pushed out). */
  get size(): number {
    return this.#entries.size;
  }

  /** The answer under `id`, or undefined for none or one that is due at `now` (that one is forgotten). A hit makes the entry the most recently used. */
  hit(id: string, now: number): boolean | undefined {
    const entry = this.#entries.get(id);
    if (entry === undefined) {
      return undefined;
    }
    this.#entries.delete(id);
    if (now >= entry.expiresAt) {
      return undefined;
    }
    this.#entries.set(id, entry);
    return entry.allowed;
  }

  /** Keeps `entry` under `id` as the most recently used, and forgets the least recently used past the maximum. */
  keep(id: string, entry: RoleEntry): void {
    this.#entries.delete(id);
    this.#entries.set(id, entry);
    for (const oldest of this.#entries.keys().take(Math.max(0, this.#entries.size - this.#maxEntries))) {
      this.#entries.delete(oldest);
    }
  }

  /** Forgets the answers whose key matches. */
  drop(matches: (key: RoleKey) => boolean): void {
    for (const [id, entry] of this.#entries) {
      if (matches(entry.key)) {
        this.#entries.delete(id);
      }
    }
  }
}
