// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { SHORT_SHA, shortSha } from './short-sha.ts';

/** U+202E, the right-to-left override. */
const RLO = String.fromCodePoint(0x202e);

// E18-S08: the lists show the first seven characters of a commit id, and write out the hidden characters of a malformed one.

test('a short id is seven characters', () => {
  expect(SHORT_SHA).toBe(7);
  expect(shortSha('0123456789abcdef0123456789abcdef01234567')).toBe('0123456');
});

test('an id shorter than seven characters is shown whole, and an empty one is empty', () => {
  expect(shortSha('abc')).toBe('abc');
  expect(shortSha('')).toBe('');
});

test('a hidden character in what the server sent is written out and never acted on', () => {
  expect(shortSha(`ab${RLO}cdef0123`)).toBe('ab<U+202E>cdef');
});
