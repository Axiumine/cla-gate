// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { PLACEHOLDER } from './interpolate.ts';

/**
 * What a catalog key looks like: segments that start with a lower-case letter and go on with letters, digits and
 * underscores (an error code is a segment: `errors.csrf_invalid`, E17-S07), at least two, joined by dots.
 */
// eslint-disable-next-line security/detect-unsafe-regex -- the segments are told apart by a literal dot, so nothing can backtrack, and the input is a catalog key of the source
export const KEY_PATTERN = /^[a-z]\w*(\.[a-z]\w*)+$/;

/** The placeholder names of a message, in order of appearance, without repeats. */
export function placeholdersOf(message: string): string[] {
  return [...new Set([...message.matchAll(PLACEHOLDER)].flatMap((match) => match.slice(1)))];
}

/** The same names, sorted, as one comparable text. */
function signature(message: string): string {
  return placeholdersOf(message)
    .sort((a, b) => a.localeCompare(b))
    .join(',');
}

/** The problems of one text: empty, or a brace that is not part of a `{name}` placeholder (the types would disagree with the runtime). */
function textProblems(key: string, value: unknown): string[] {
  if (typeof value !== 'string' || value === '') {
    return [`${key}: not a non-empty string`];
  }
  return /[{}]/.test(value.replace(PLACEHOLDER, '')) ? [`${key}: a brace that is not a placeholder`] : [];
}

/** A `<base>.one` needs a `<base>.other` that uses the same placeholders. */
function pluralProblems(key: string, value: unknown, catalog: Readonly<Record<string, unknown>>): string[] {
  const other = catalog[`${key.slice(0, -'.one'.length)}.other`];
  if (typeof other !== 'string') {
    return [`${key}: no .other sibling`];
  }
  return typeof value === 'string' && signature(other) !== signature(value)
    ? [`${key}: its .other sibling uses different placeholders`]
    : [];
}

/**
 * Every way a catalog breaks the rules of E17-S02, as one line each; an empty list is a sound catalog. A key must have the
 * dotted shape, a value must be a non-empty string whose braces are all `{name}` placeholders, and every `<base>.one` needs
 * a `<base>.other` with the same placeholders.
 */
export function catalogProblems(catalog: Readonly<Record<string, unknown>>): string[] {
  return Object.entries(catalog).flatMap(([key, value]) => [
    ...(KEY_PATTERN.test(key) ? [] : [`${key}: not a dotted key`]),
    ...textProblems(key, value),
    ...(key.endsWith('.one') ? pluralProblems(key, value, catalog) : []),
  ]);
}
