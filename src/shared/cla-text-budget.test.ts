// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { CLA_TEXT_MAX_BYTES, canonicalise, validateClaText } from './cla-text.ts';

// A text is validated on the request that saves or publishes it, on the one thread that serves every tenant and the webhooks. The
// Markdown parser of the rendering takes minutes for the texts below at the size limit (its time grows with the square of the number
// of lines), so the validation must never wait for it: each text of 200 KiB is read in a fraction of a second. The budget is wall
// time of two seconds, about a hundred times what the scan needs and a fiftieth of what the parser needs, so a loaded machine
// does not fail it and a parser on this path always does.

const BUDGET_MS = 2000;

/** The canonical text made of `unit` repeated as often as fits in the size limit. */
function filling(unit: string): string {
  return canonicalise(unit.repeat(Math.floor(CLA_TEXT_MAX_BYTES / unit.length)));
}

test.each([
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
])('validateClaText accepts 200 KiB of %s and reads it in under two seconds', (_label, unit) => {
  const text = filling(unit);
  expect(new TextEncoder().encode(text).byteLength).toBeGreaterThan(CLA_TEXT_MAX_BYTES - 100);
  const started = performance.now();
  expect(validateClaText(text)).toBeNull();
  expect(performance.now() - started).toBeLessThan(BUDGET_MS);
});

test.each([
  ['51 nested quotes on every line', `${'> '.repeat(51)}a\n`],
  ['a deep list after a long run of lines', `${'a\n=\n'.repeat(10_000)}${'> '.repeat(51)}a\n`],
])('validateClaText refuses 200 KiB of %s as too deeply nested in under two seconds', (_label, unit) => {
  const text = filling(unit);
  const started = performance.now();
  expect(validateClaText(text)).toEqual({ rule: 'content_too_deeply_nested' });
  expect(performance.now() - started).toBeLessThan(BUDGET_MS);
});
