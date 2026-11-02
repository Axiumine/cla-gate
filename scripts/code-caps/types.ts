// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/** Caps (a value ABOVE the cap is a violation). */
export const CAPS = { file: 500, function: 50, class: 300, params: 4, nesting: 4 };

export const BASELINE_NAME = '.code-caps-baseline.json';
export const BASELINE_VERSION = 1;

export type Kind = keyof typeof CAPS;

/** One cap violation: where it is, what was measured. */
export interface Measure {
  readonly path: string;
  readonly line: number;
  readonly kind: Kind;
  readonly name: string;
  readonly value: number;
}

/** Expected failure (bad source, bad baseline): reported as exit code 2, without a stack trace. */
export class CapsError extends Error {}

/** Code-point order: identical on every machine and locale, and the order Python sorted baseline keys in. */
export function compareNames(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  // Stryker disable next-line EqualityOperator: equal names returned above, so `a` and `b` differ here and `<=` gives the same answer as `<`
  return a < b ? -1 : 1;
}

/** `text` with control characters (terminal escape sequences, newlines) shown as `\xNN`. */
export function printable(text: string): string {
  return text.replace(/\p{Cc}/gu, (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

export function measureKey(item: Pick<Measure, 'path' | 'kind' | 'name'>): string {
  return `${item.path}::${item.kind}::${item.name}`;
}
