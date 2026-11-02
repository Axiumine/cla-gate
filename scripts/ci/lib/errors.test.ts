// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { messageOf, reportLines } from './errors.ts';

test.each([
  ['an Error', new Error('boom'), 'boom'],
  ['a TypeError', new TypeError('bad type'), 'bad type'],
  ['a string', 'plain string', 'plain string'],
  ['a number', 42, '42'],
  ['undefined', undefined, 'undefined'],
  ['control characters', new Error('a\u001b[31mb\u0007'), 'a\\x1b[31mb\\x07'],
  ['several lines', new Error('first\nsecond\u0000'), 'first\nsecond\\x00'],
])('messageOf(%s)', (_what, thrown, expected) => {
  expect(messageOf(thrown)).toBe(expected);
});

test('a report is the first line with the tool and command, then one prefixed line per further line', () => {
  expect(reportLines('ci-x', 'run', new Error('first\nsecond\n::notice::third'))).toEqual([
    'ci-x run: first',
    '| second',
    '| ::notice::third',
  ]);
});

test('a report line has its control characters escaped', () => {
  expect(reportLines('ci-x', 'stop', 'bad\u001b[31m\nnext\u0007')).toEqual(['ci-x stop: bad\\x1b[31m', '| next\\x07']);
});
