// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { retentionCutoff } from './network-retention.ts';

// The cutoff of the network metadata retention (E16-S05). The domain has no `Date`, so the instants are epoch milliseconds;
// the ISO text beside each is what they stand for.

/** 2026-11-03T03:17:00.000Z */
const NOW = 1_793_675_820_000;

test.each([
  [1, 1_793_589_420_000, '2026-11-02T03:17:00.000Z'],
  [30, 1_791_083_820_000, '2026-10-04T03:17:00.000Z'],
  [90, 1_785_899_820_000, '2026-08-05T03:17:00.000Z'],
])('%i days before 2026-11-03T03:17Z is %s milliseconds, which is %s', (days, expected) => {
  expect(retentionCutoff(NOW, days)).toBe(expected);
});

test('a day is 24 hours of UTC: a clock change in a time zone moves nothing', () => {
  // 2026-03-29 is the day Europe changes to summer time (a 23 hour day there); in UTC it is a 24 hour day like any other.
  // now 2026-03-30T12:00:00Z, two days earlier 2026-03-28T12:00:00Z.
  expect(retentionCutoff(1_774_872_000_000, 2)).toBe(1_774_699_200_000);
});

test('the millisecond is kept', () => {
  // 2026-11-03T03:17:00.123Z minus 30 days is 2026-10-04T03:17:00.123Z.
  expect(retentionCutoff(1_793_675_820_123, 30)).toBe(1_791_083_820_123);
});
