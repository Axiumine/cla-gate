// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  DEFAULT_RETENTION_BATCH_SIZE,
  DEFAULT_WEBHOOK_DELIVERIES_DAYS,
  deliveryCutoff,
  MAX_RETENTION_BATCH_SIZE,
  MAX_WEBHOOK_DELIVERIES_DAYS,
  MIN_WEBHOOK_DELIVERIES_DAYS,
  sessionCutoff,
} from './retention.ts';

// The cutoffs of the retention sweep (E22-S04). The domain has no `Date`, so the instants are epoch milliseconds; the ISO
// text beside each is what they stand for.

/** 2026-11-03T03:17:00.000Z */
const NOW = 1_793_675_820_000;

test('the limits are the ones of the story: 7 days at the least, 30 by default, 5000 rows a batch', () => {
  expect(MIN_WEBHOOK_DELIVERIES_DAYS).toBe(7);
  expect(DEFAULT_WEBHOOK_DELIVERIES_DAYS).toBe(30);
  expect(MAX_WEBHOOK_DELIVERIES_DAYS).toBe(3650);
  expect(DEFAULT_RETENTION_BATCH_SIZE).toBe(5000);
  expect(MAX_RETENTION_BATCH_SIZE).toBe(100_000);
});

test.each([
  [7, 1_793_071_020_000, '2026-10-27T03:17:00.000Z'],
  [30, 1_791_083_820_000, '2026-10-04T03:17:00.000Z'],
  [3650, 1_478_315_820_000, '2016-11-05T03:17:00.000Z'],
])(
  'a delivery processed %i days before 2026-11-03T03:17Z is purged: the cutoff is %s, which is %s',
  (days, expected) => {
    expect(deliveryCutoff(NOW, days)).toBe(expected);
  },
);

test('a session is purged one day after it died: 2026-11-02T03:17Z, and the millisecond is kept', () => {
  expect(sessionCutoff(NOW)).toBe(1_793_589_420_000);
  expect(sessionCutoff(NOW + 123)).toBe(1_793_589_420_123);
});
