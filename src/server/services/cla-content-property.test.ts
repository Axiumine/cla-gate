// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { canonicalise, validateClaText } from '../../shared/cla-text.ts';
import { seededRandom } from '../domain/evaluation/test-support.ts';
import { sha256Hex } from './cla-content.ts';

// The properties of the canonical text (E12-S02), checked over 1 000 texts made by a seeded generator. Every assertion names
// its seed, so a failure is rerun with `textOf(seed)` and nothing else.

const FIRST_SEED = 20_261_103;
const TEXTS = 1000;

/** The pieces a text is built from: every line ending, the byte order mark, white space, controls, surrogates and marks. */
const PIECES = [
  'a',
  'Agree',
  ' ',
  '  ',
  '\t',
  '\n',
  '\r',
  '\r\n',
  '\n\n',
  '﻿',
  'é',
  'é',
  '\u{1F600}',
  '中',
  '\u0000',
  '\ud800',
  '\udc00',
  ' ',
  '# ',
  '**',
  '  \n',
];

/** A text of 0 to 59 pieces, fixed by `seed`. */
function textOf(seed: number): string {
  const next = seededRandom(seed);
  const length = Math.floor(next() * 60);
  return Array.from({ length }, () => PIECES[Math.floor(next() * PIECES.length)]).join('');
}

const seeds = Array.from({ length: TEXTS }, (_unused, index) => FIRST_SEED + index);

test('canonicalise is idempotent, and its text ends in one line feed and holds no carriage return or leading byte order mark', () => {
  for (const seed of seeds) {
    const once = canonicalise(textOf(seed));
    const label = `seed ${seed}`;
    expect(canonicalise(once), label).toBe(once);
    expect(once.endsWith('\n'), label).toBe(true);
    expect(once.endsWith('\n\n'), label).toBe(false);
    expect(once.includes('\r'), label).toBe(false);
    expect(once.startsWith('﻿'), label).toBe(false);
  }
});

test('the hash of the canonical text is stable: it does not change on a second canonicalisation, or with the line ending of the editor', () => {
  for (const seed of seeds) {
    const text = textOf(seed);
    const canonical = canonicalise(text);
    const hash = sha256Hex(canonical);
    const label = `seed ${seed}`;
    expect(hash, label).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(canonicalise(canonical)), label).toBe(hash);
    expect(sha256Hex(canonicalise(text.replaceAll(/\r\n|\r|\n/g, '\r\n'))), `${label} with CRLF`).toBe(hash);
    expect(sha256Hex(canonicalise(text.replaceAll(/\r\n|\r|\n/g, '\r'))), `${label} with CR`).toBe(hash);
    expect(sha256Hex(canonicalise(`${text}\n\n`)), `${label} with final newlines`).toBe(hash);
  }
});

// A lone surrogate has no UTF-8 form, so two texts that differ only in one hash alike: validateClaText refuses them first.
test('among the texts that validateClaText accepts, one hash is one canonical text', () => {
  const textOfHash = new Map<string, string>();
  for (const seed of seeds) {
    const canonical = canonicalise(textOf(seed));
    if (validateClaText(canonical) === null) {
      const hash = sha256Hex(canonical);
      expect(textOfHash.get(hash) ?? canonical, `seed ${seed}`).toBe(canonical);
      textOfHash.set(hash, canonical);
    }
  }
  expect(textOfHash.size).toBeGreaterThan(20);
});
