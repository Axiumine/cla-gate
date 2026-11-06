// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { endsBeforeStart, instantDisplay, instantText } from './audit-instant.ts';

// E18-S09: the moments of the audit range. A date is the start of that day in UTC, an instant ends in `Z`, and both come out in
// the one canonical text the server is asked with.

test.each([
  ['a date, the start of that day', '2026-11-01', '2026-11-01T00:00:00.000Z'],
  ['an instant to the second', '2026-11-01T09:30:00Z', '2026-11-01T09:30:00.000Z'],
  ['an instant to the millisecond', '2026-11-01T09:30:00.123Z', '2026-11-01T09:30:00.123Z'],
  ['a leap day', '2028-02-29', '2028-02-29T00:00:00.000Z'],
])('%s, %s, is read as %s', (_what, text, canonical) => {
  expect(instantText.parse(text)).toBe(canonical);
});

test.each([
  ['an offset, which would make a local time pass for UTC', '2026-11-01T09:30:00+02:00'],
  ['no zone', '2026-11-01T09:30:00'],
  ['an instant with no seconds', '2026-11-01T09:30Z'],
  ['a date that does not exist', '2026-02-30'],
  ['a leap day of a year that has none', '2027-02-29'],
  ['more than three decimals, which the server would round', '2026-11-01T09:30:00.1234Z'],
  ['a date with a slash', '2026/11/01'],
  ['words', 'yesterday'],
  ['nothing', ''],
  ['a number', '1762000000'],
])('%s, %s, is not an instant', (_what, text) => {
  expect(instantText.safeParse(text).success).toBe(false);
});

test.each([
  ['the start of a day is the date', '2026-11-01T00:00:00.000Z', '2026-11-01'],
  ['a whole second loses its thousandths', '2026-11-01T09:30:15.000Z', '2026-11-01T09:30:15Z'],
  ['a time with thousandths is kept whole', '2026-11-01T09:30:15.250Z', '2026-11-01T09:30:15.250Z'],
  ['a day that does not start at midnight keeps its time', '2026-11-01T00:00:01.000Z', '2026-11-01T00:00:01Z'],
])('%s: %s is written %s', (_what, instant, shown) => {
  expect(instantDisplay(instant)).toBe(shown);
  expect(instantText.parse(shown)).toBe(instant);
});

test.each([
  ['the end is earlier than the start', '2026-11-02T00:00:00.000Z', '2026-11-01T00:00:00.000Z', true],
  ['the end is a millisecond earlier', '2026-11-02T00:00:00.000Z', '2026-11-01T23:59:59.999Z', true],
  [
    'the end is the start, an empty range and not a backwards one',
    '2026-11-01T00:00:00.000Z',
    '2026-11-01T00:00:00.000Z',
    false,
  ],
  ['the end is later', '2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z', false],
  ['there is no start', undefined, '2026-11-01T00:00:00.000Z', false],
  ['there is no end', '2026-11-01T00:00:00.000Z', undefined, false],
  ['there is neither', undefined, undefined, false],
])('a range where %s ends before it starts: %s', (_what, from, to, backwards) => {
  expect(endsBeforeStart(from, to)).toBe(backwards);
});
