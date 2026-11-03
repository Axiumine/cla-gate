// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { sameSecret } from './setup-digest.ts';

// E19-S06: secrets are compared by their SHA-256 digests in constant time.

test('the same string is the same secret, including an empty one and one with unusual characters', () => {
  expect(sameSecret('abc', 'abc')).toBe(true);
  expect(sameSecret('', '')).toBe(true);
  expect(sameSecret('é \u{1F680}\n', 'é \u{1F680}\n')).toBe(true);
});

test.each([
  ['a different last character', 'abd'],
  ['a prefix', 'ab'],
  ['an extension', 'abcd'],
  ['another case', 'ABC'],
  ['a trailing space', 'abc '],
  ['an empty string', ''],
])('%s is not the same secret', (_what, presented) => {
  expect(sameSecret('abc', presented)).toBe(false);
});

test.each([[undefined], [null], [7], [['abc']], [{ toString: () => 'abc' }], [Buffer.from('abc')]])(
  'a value that is not a string, %j, is never the same secret, whatever it prints as',
  (presented) => {
    expect(sameSecret('abc', presented)).toBe(false);
  },
);
