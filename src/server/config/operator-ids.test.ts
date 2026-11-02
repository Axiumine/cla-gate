// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseOperatorGithubIds } from './operator-ids.ts';

// `OPERATOR_GITHUB_IDS` (E11-S08): a list of positive integers, trimmed, without duplicates, at most 20.

const distinct = (count: number): string => Array.from({ length: count }, (_unused, index) => index + 1).join(',');

test.each([
  ['one id', '9001', [9001]],
  ['two ids', '9001,42', [9001, 42]],
  ['whitespace around each id', '  9001 ,\t42\n, 7 ', [9001, 42, 7]],
  ['a duplicate collapsed to its first place', '5,9,5,9,5', [5, 9]],
  ['the largest safe integer', String(Number.MAX_SAFE_INTEGER), [Number.MAX_SAFE_INTEGER]],
  ['exactly 20 distinct ids', distinct(20), Array.from({ length: 20 }, (_unused, index) => index + 1)],
  ['21 entries of which one repeats (20 distinct)', `${distinct(20)},1`, Array.from({ length: 20 }, (_u, i) => i + 1)],
])('%s is a list of operator ids', (_label, text, ids) => {
  expect(parseOperatorGithubIds(text)).toEqual(ids);
});

test.each([
  ['an empty string', ''],
  ['spaces only', '   '],
  ['a tab and a newline', '\t\n'],
])('%s names no operator: the variable counts as unset', (_label, text) => {
  expect(parseOperatorGithubIds(text)).toEqual([]);
});

test.each([
  ['a login', 'octocat'],
  ['a login among ids', '9001,octocat'],
  ['an at-prefixed login', '@octocat'],
  ['a negative number', '-1'],
  ['zero', '0'],
  ['zero among ids', '9001,0'],
  ['a leading zero', '007'],
  ['a plus sign', '+7'],
  ['a decimal', '1.5'],
  ['an exponent', '1e3'],
  ['hexadecimal', '0x10'],
  ['a wildcard', '*'],
  ['a number above Number.MAX_SAFE_INTEGER', '9007199254740992'],
  ['an empty element', '1,,2'],
  ['a trailing comma', '1,2,'],
  ['a leading comma', ',1'],
  ['a semicolon as the separator', '1;2'],
  ['21 distinct ids', distinct(21)],
])('%s is not a list of operator ids', (_label, text) => {
  expect(parseOperatorGithubIds(text)).toBeUndefined();
});
