// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

const MS_PER_MINUTE = 60_000;

/**
 * A token bucket counted in points (E05-S05): it holds at most `capacity` points and gets `perMinute` back every minute.
 * A request takes its points when it asks; when the bucket cannot cover them it goes into debt and the answer is how
 * long to wait, so requests that ask one after another are told to wait one after another and none is dropped.
 */
export class PointBucket {
  readonly #capacity: number;
  readonly #perMs: number;
  #level: number;
  #updatedMs: number;

  constructor(capacity: number, perMinute: number, nowMs: number) {
    this.#capacity = capacity;
    this.#perMs = perMinute / MS_PER_MINUTE;
    this.#level = capacity;
    this.#updatedMs = nowMs;
  }

  /** Takes `cost` points. @returns how many milliseconds to wait before using them: 0 when the bucket covered them. */
  take(cost: number, nowMs: number): number {
    this.#refill(nowMs);
    this.#level -= cost;
    return this.#level >= 0 ? 0 : Math.ceil(-this.#level / this.#perMs);
  }

  /** True when every point is back: a bucket that is full is the same as a new one. */
  isFull(nowMs: number): boolean {
    this.#refill(nowMs);
    return this.#level >= this.#capacity;
  }

  #refill(nowMs: number): void {
    // A clock that steps back (a correction) gives nothing back; it never takes points away.
    const elapsed = Math.max(0, nowMs - this.#updatedMs);
    this.#level = Math.min(this.#capacity, this.#level + elapsed * this.#perMs);
    this.#updatedMs = Math.max(this.#updatedMs, nowMs);
  }
}
