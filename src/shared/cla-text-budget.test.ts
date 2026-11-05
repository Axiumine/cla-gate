// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { CLA_TEXT_MAX_BYTES, canonicalise, validateClaText } from './cla-text.ts';
import { MOST_LINEAR_SLOWDOWN, slowdownOf, TIMED_BYTES } from './test-support.ts';

// A text is validated on the request that saves or publishes it, on the one thread that serves every tenant and the webhooks. The
// Markdown parser of the rendering takes minutes for the texts below at the size limit (its time grows with the square of the number
// of lines), so the validation must never wait for it: its time is linear in the size of the text. That is checked as a slowdown,
// not as seconds: one pass over a text of 64 KiB (`TIMED_BYTES`) must take about as long as sixteen passes over a text of a sixteenth of the size
// (a ratio of 1; a quadratic scan gives 16, and the limit is 6, `slowdownOf`). A bound in seconds failed on a loaded runner (3.2 s
// for a scan that needs 15 ms, in the dry run of the mutation gate), and a parser on this path fails the ratio, and the test
// timeout, at any speed. Each case returns the canonical text of at most the size it is given.

/** `unit` repeated as often as fits in `bytes`, as a canonical text. */
function repeating(unit: string): (bytes: number) => string {
  return (bytes) => canonicalise(unit.repeat(Math.floor(bytes / unit.length)));
}

const ACCEPTED: readonly (readonly [label: string, unit: string])[] = [
  ['one-line setext headings underlined with =', 'a\n=\n'],
  ['one-line setext headings underlined with -', 'a\n---\n'],
  ['two-line setext headings', 'a\nb\n=\n'],
  ['quote lines each followed by a lazy line', '> a\nb\n'],
  ['reference-style links, one to a line', '[a]\n'],
  ['lines that each open 49 nested bullets', `${'- '.repeat(49)}a\n`],
  ['lines that each open 49 nested quotes', `${'> '.repeat(49)}a\n`],
  ['bullets nested by indentation, line after line', '- a\n  - b\n    - c\n'],
  ['numbered items with a quote in each', '1. > a\n2. > b\n'],
  ['fences that are never closed', '```\n> a\n'],
];

test.each(ACCEPTED)('validateClaText accepts 200 KiB of %s and reads it in time linear in its size', (_label, unit) => {
  const text = repeating(unit)(CLA_TEXT_MAX_BYTES);
  expect(new TextEncoder().encode(text).byteLength).toBeGreaterThan(CLA_TEXT_MAX_BYTES - 100);
  expect(validateClaText(text)).toBeNull();
  expect(slowdownOf(validateClaText, repeating(unit), TIMED_BYTES)).toBeLessThan(MOST_LINEAR_SLOWDOWN);
});

/** A run of setext headings that fills the size, and then a line of 51 nested quotes at the very end. */
const deepAfterRun = (bytes: number): string =>
  canonicalise(`${'a\n=\n'.repeat(Math.floor((bytes - 104) / 4))}${'> '.repeat(51)}a\n`);

const REFUSED: readonly (readonly [label: string, build: (bytes: number) => string])[] = [
  ['51 nested quotes on every line', repeating(`${'> '.repeat(51)}a\n`)],
  ['a deep list after a long run of lines', deepAfterRun],
];

test.each(REFUSED)(
  'validateClaText refuses 200 KiB of %s as too deeply nested in time linear in its size',
  (_label, build) => {
    expect(validateClaText(build(CLA_TEXT_MAX_BYTES))).toEqual({ rule: 'content_too_deeply_nested' });
    expect(slowdownOf(validateClaText, build, TIMED_BYTES)).toBeLessThan(MOST_LINEAR_SLOWDOWN);
  },
);
