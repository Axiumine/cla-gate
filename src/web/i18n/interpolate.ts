// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/** What a placeholder is replaced with: text, or a number written the plain way. */
export type MessageValue = string | number;

/**
 * A `{name}` placeholder: a lower-case letter, then letters and digits. Anything else with braces is not one.
 * @internal Read by the catalog checks of the tests too (test-support.ts).
 */
export const PLACEHOLDER = /\{([a-z][A-Za-z0-9]*)}/g;

/**
 * Replaces each `{name}` in `message` with the value of `name`, in ONE pass over the message. A value is inserted as it
 * is and is never read again, so a value that holds `{name}`, `{other}`, `{` or `$&` shows as typed and cannot pull in
 * another parameter. A placeholder that has no value stays as written (the types make that unreachable for `t`).
 */
export function interpolate(message: string, values: Readonly<Record<string, MessageValue>>): string {
  const own = new Map(Object.entries(values));
  return message.replace(PLACEHOLDER, (placeholder, name: string) => {
    const value = own.get(name);
    return value === undefined ? placeholder : String(value);
  });
}
