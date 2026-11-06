// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { digitsAsText, searchTextOf } from './search-text.ts';

// E18-S10: the one cleaning of a search text that the signatures box and the repositories box share.

test.each([
  ['a word', 'widgets', 'widgets'],
  ['a word with blanks around it', '  widgets \t', 'widgets'],
  ['a text of exactly the longest length', 'a'.repeat(10), 'a'.repeat(10)],
  ['a text with an inner blank', 'a b', 'a b'],
])('%s is a search as it is, trimmed', (_what, text, expected) => {
  expect(searchTextOf(text, 10)).toBe(expected);
});

test.each([
  ['nothing', ''],
  ['blanks', ' \t\n '],
  ['a text one character longer than the longest', 'a'.repeat(11)],
  ['a text with a NUL', 'wid\0gets'],
  ['a text with a lone surrogate', 'wid\uD800gets'],
])('%s is no search: nothing is sent', (_what, text) => {
  expect(searchTextOf(text, 10)).toBeUndefined();
});

test('the length is counted after the blanks around the text are gone', () => {
  expect(searchTextOf(` ${'a'.repeat(10)} `, 10)).toBe('a'.repeat(10));
});

test.each([
  ['a whole number the router parsed', 4711, '4711'],
  ['zero', 0, '0'],
])('%s is put back into the text it was written as', (_what, value, expected) => {
  expect(digitsAsText(value)).toBe(expected);
});

test.each([
  ['a negative number', -1],
  ['a decimal', 1.5],
  ['a number beyond what a number holds exactly', 2 ** 53],
  ['a text', 'octocat'],
  ['a boolean', true],
  ['null', null],
])('%s is left as it is', (_what, value) => {
  expect(digitsAsText(value)).toBe(value);
});
