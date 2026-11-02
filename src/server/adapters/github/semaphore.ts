// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * A counting semaphore (E05-S05): at most `limit` runs at once, the rest wait in the order they asked. A run gives its
 * place back when it settles, whichever way, so a request that fails never keeps a place.
 */
export class Semaphore {
  readonly #limit: number;
  #running = 0;
  readonly #waiting: (() => void)[] = [];

  constructor(limit: number) {
    this.#limit = limit;
  }

  /** Runs `work` as soon as a place is free. */
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.#running >= this.#limit) {
      await new Promise<void>((resolve) => {
        this.#waiting.push(resolve);
      });
    } else {
      this.#running += 1;
    }
    try {
      return await work();
    } finally {
      // The place passes straight to the next in line; the count only drops when nobody waits.
      const next = this.#waiting.shift();
      if (next === undefined) {
        this.#running -= 1;
      } else {
        next();
      }
    }
  }
}
