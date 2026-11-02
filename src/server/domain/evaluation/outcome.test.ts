// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { outcomeOf, sortedUniqueCodes } from './outcome.ts';
import { shuffled } from './test-support.ts';
import { FAILURE_CODES, type FailureCode } from './types.ts';

// E08-S04: the outcome follows from the failure codes and from nothing else, and the codes are a sorted set.

test.each(FAILURE_CODES)('a result with the single code %s is a failure', (code) => {
  expect(outcomeOf([code])).toBe('failure');
});

test('a result with no failure code is a success', () => {
  expect(outcomeOf([])).toBe('success');
});

test('repeats collapse and the order is alphabetical by code unit, whatever the order they came in', () => {
  const codes: FailureCode[] = ['unsigned_contributor', 'bot_not_allowlisted', 'unsigned_contributor', 'no_active_cla'];
  const expected = ['bot_not_allowlisted', 'no_active_cla', 'unsigned_contributor'];
  expect(sortedUniqueCodes(codes)).toEqual(expected);
  for (let seed = 1; seed <= 20; seed += 1) {
    expect(sortedUniqueCodes(shuffled(codes, seed))).toEqual(expected);
  }
});

test('no codes give an empty list, and every code once gives the whole closed list sorted', () => {
  expect(sortedUniqueCodes([])).toEqual([]);
  expect(sortedUniqueCodes(FAILURE_CODES)).toEqual([...FAILURE_CODES].sort((a, b) => (a < b ? -1 : 1)));
});
