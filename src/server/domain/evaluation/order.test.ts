// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { compareText } from './order.ts';

test.each([
  ['equal strings', 'abc', 'abc', 0],
  ['an earlier letter first', 'abc', 'abd', -1],
  ['a later letter second', 'abd', 'abc', 1],
  ['a prefix before its extension', 'ab', 'abc', -1],
  ['an extension after its prefix', 'abc', 'ab', 1],
  ['hex digits before hex letters', '9', 'a', -1],
  ['upper case before lower case, whatever the locale says', 'B', 'a', -1],
  ['the empty string first', '', 'a', -1],
])('compareText orders %s', (_name, a, b, expected) => {
  expect(compareText(a, b)).toBe(expected);
});

test('sorting with compareText is stable across runs and independent of the input order', () => {
  const shas = ['0f', '0a', 'ff', '00', '0A'];
  expect([...shas].sort(compareText)).toEqual(['00', '0A', '0a', '0f', 'ff']);
  expect([...shas].reverse().sort(compareText)).toEqual(['00', '0A', '0a', '0f', 'ff']);
});
