// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { compareNames, measureKey, printable } from './types.ts';

test('names compare by code point, whatever the locale', () => {
  expect(compareNames('a', 'a')).toBe(0);
  expect(compareNames('B', 'a')).toBe(-1);
  expect(compareNames('a', 'B')).toBe(1);
  expect(['b', 'a_b', 'a-b', 'A'].sort(compareNames)).toEqual(['A', 'a-b', 'a_b', 'b']);
});

test.each<[string, string]>([
  ['plain text', 'plain text'],
  ['caf\u00e9 \u4e2d', 'caf\u00e9 \u4e2d'],
  ['\u001b[2Jx', '\\x1b[2Jx'],
  ['a\nb\tc', 'a\\x0ab\\x09c'],
  ['\u0007\u007f', '\\x07\\x7f'],
])('printable(%j) shows control characters as hex escapes', (text, shown) => {
  expect(printable(text)).toBe(shown);
});

test('a key joins path, kind and name', () => {
  expect(measureKey({ path: 'a/b.ts', kind: 'function', name: 'C.m' })).toBe('a/b.ts::function::C.m');
});
