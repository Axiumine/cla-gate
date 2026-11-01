// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { inspect } from 'node:util';

/**
 * What every way of printing a {@link Secret} produces.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const MASK = '[REDACTED]';

/**
 * A string that cannot reach a log, a template literal, `JSON.stringify` or `util.inspect` by accident: all of them
 * print {@link MASK}. The only way to the value is the explicit, greppable `reveal()`.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return MASK;
  }

  toJSON(): string {
    return MASK;
  }

  [inspect.custom](): string {
    return MASK;
  }

  [Symbol.toPrimitive](): string {
    return MASK;
  }
}
