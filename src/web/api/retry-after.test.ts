// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { MAX_RETRY_AFTER_SECONDS, parseRetryAfter } from './retry-after.ts';

const NOW = Date.parse('Sun, 06 Nov 1994 08:49:37 GMT');

test.each([
  ['whole seconds', '120', 120],
  ['zero', '0', 0],
  ['seconds with spaces around them', '  30 ', 30],
  ['an HTTP date 90 seconds ahead', 'Sun, 06 Nov 1994 08:51:07 GMT', 90],
  ['an HTTP date now', 'Sun, 06 Nov 1994 08:49:37 GMT', 0],
  ['an HTTP date in the past', 'Sun, 06 Nov 1994 08:00:00 GMT', 0],
  ['a seconds value over a day, cut to a day', '999999999', MAX_RETRY_AFTER_SECONDS],
  ['a seconds value too large for a number, cut to a day', '9'.repeat(400), MAX_RETRY_AFTER_SECONDS],
  ['an HTTP date far ahead, cut to a day', 'Mon, 07 Nov 2044 08:49:37 GMT', MAX_RETRY_AFTER_SECONDS],
])('Retry-After as %s is %s seconds', (_what, header, expected) => {
  expect(parseRetryAfter(header, NOW)).toBe(expected);
});

test.each([
  ['no header', null],
  ['an empty header', ''],
  ['negative seconds', '-5'],
  ['a decimal', '1.5'],
  ['text', 'soon'],
  ['a bare number that Date.parse would take for a year', '2001 Jan'],
  ['a date in another format', '1994-11-06T08:51:07Z'],
  ['a date that is not a date', 'Foo, 99 Bar 1994 99:99:99 GMT'],
])('Retry-After as %s is not understood', (_what, header) => {
  expect(parseRetryAfter(header, NOW)).toBeUndefined();
});

test('a date that falls between two seconds of the clock waits for the later second', () => {
  expect(parseRetryAfter('Sun, 06 Nov 1994 08:49:37 GMT', NOW - 500)).toBe(1);
});
