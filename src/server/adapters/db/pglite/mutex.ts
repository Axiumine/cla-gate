// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
/** A FIFO lock: `acquire()` resolves with the `release` function once every earlier holder released. */
export class Mutex {
  #tail: Promise<void> = Promise.resolve();

  acquire(): Promise<() => void> {
    const previous = this.#tail;
    const { promise, resolve }: PromiseWithResolvers<void> = Promise.withResolvers();
    this.#tail = previous.then(() => promise);
    return previous.then(() => resolve);
  }
}
