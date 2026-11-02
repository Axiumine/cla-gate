// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * Lets concurrent callers for one key share a single run of an async function (E05-S03): the first caller starts it,
 * the others that arrive while it runs get the same promise, and once it settles (either way) the next caller starts a
 * new one. Keys never wait on each other.
 */
export class SingleFlight<Key, Value> {
  readonly #running = new Map<Key, Promise<Value>>();

  /** The run in progress for `key`, or the one that `start` begins now. */
  run(key: Key, start: () => Promise<Value>): Promise<Value> {
    const running = this.#running.get(key);
    if (running !== undefined) {
      return running;
    }
    const flight = start().finally(() => {
      this.#running.delete(key);
    });
    this.#running.set(key, flight);
    return flight;
  }
}
