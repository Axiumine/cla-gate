// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// How the search boxes of the lists read what a person typed or what an address holds (E18-S07, E18-S10): the one cleaning of a search
// text, so a text that cannot be sent is no search at all instead of a `400`.

/**
 * The search text as a list uses it: trimmed, and `undefined` when nothing is left or the text is one an endpoint refuses (longer than
 * `maxLength`, a lone surrogate or a NUL, which the database cannot hold).
 */
export function searchTextOf(text: string, maxLength: number): string | undefined {
  const trimmed = text.trim();
  const sendable = trimmed !== '' && trimmed.length <= maxLength && trimmed.isWellFormed() && !trimmed.includes('\0');
  return sendable ? trimmed : undefined;
}

/**
 * The router reads a value that looks like a number as a number (`?q=4711` is 4711), and a search of digits is a search. A safe whole
 * number is put back into the text it was written as; anything else that is not text is left for the schema to drop.
 */
export function digitsAsText(value: unknown): unknown {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : value;
}
