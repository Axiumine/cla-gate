// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { inspect } from 'node:util';

/**
 * What every way of printing a {@link Secret} produces. A function and not a constant, so that the text is made when a
 * {@link Secret} is printed and the mutation gate's tests see it (see "Module-level code" in docs/quality-gates.md).
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function mask(): string {
  return '[REDACTED]';
}

/**
 * A string that cannot reach a log, a template literal, `JSON.stringify` or `util.inspect` by accident: all of them
 * print {@link mask}. The only way to the value is the explicit, greppable `reveal()`.
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
    return mask();
  }

  toJSON(): string {
    return mask();
  }

  [inspect.custom](): string {
    return mask();
  }

  [Symbol.toPrimitive](): string {
    return mask();
  }
}
