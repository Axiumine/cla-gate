// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseAllowedAccountIds } from './allowed-accounts.ts';

const MAX_SAFE = String(Number.MAX_SAFE_INTEGER);
const distinct = (count: number): string => Array.from({ length: count }, (_unused, index) => index + 1).join(',');

test.each([
  ['one id', '9001', [9001]],
  ['two ids', '9001,42', [9001, 42]],
  ['whitespace around each id', '  9001 ,\t42\n, 7 ', [9001, 42, 7]],
  ['a duplicate collapsed to its first place', '5,9,5,9,5', [5, 9]],
  ['the same id spelled with and without spaces', '5, 5 ,5', [5]],
  ['the largest safe integer', MAX_SAFE, [Number.MAX_SAFE_INTEGER]],
  ['exactly 100 distinct ids', distinct(100), Array.from({ length: 100 }, (_unused, index) => index + 1)],
  [
    '101 entries of which one repeats (100 distinct)',
    `${distinct(100)},1`,
    Array.from({ length: 100 }, (_u, i) => i + 1),
  ],
])('%s is a list of account ids', (_label, text, ids) => {
  expect(parseAllowedAccountIds(text)).toEqual(ids);
});

test.each([
  ['an empty string', ''],
  ['spaces only', '   '],
  ['a tab and a newline', '\t\n'],
])('%s is an empty list: the App owner only', (_label, text) => {
  expect(parseAllowedAccountIds(text)).toEqual([]);
});

test.each([
  ['a login', 'octocat'],
  ['a login among ids', '9001,octocat'],
  ['an at-prefixed login', '@octocat'],
  ['a negative number', '-5'],
  ['zero', '0'],
  ['zero among ids', '9001,0'],
  ['a leading zero', '007'],
  ['a plus sign', '+7'],
  ['a decimal', '1.5'],
  ['an exponent', '1e3'],
  ['hexadecimal', '0x10'],
  ['a wildcard', '*'],
  ['a number above Number.MAX_SAFE_INTEGER', '9007199254740992'],
  ['a number whose double rounds to a safe-looking one', '9007199254740993'],
  ['a number of 400 digits', '9'.repeat(400)],
  ['an empty element', '1,,2'],
  ['a trailing comma', '1,2,'],
  ['a leading comma', ',1'],
  ['a comma alone', ','],
  ['a space inside an id', '12 34'],
  ['a semicolon list', '1;2'],
  ['full-width digits', '１２３'],
  ['101 distinct ids', distinct(101)],
])('%s is refused', (_label, text) => {
  expect(parseAllowedAccountIds(text)).toBeUndefined();
});
