// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { boundsDrifted, updateFor } from './queue-options.ts';
import type { QueueSettings } from './queues.ts';
import { EXPECTED_BOUNDS } from './test-support.ts';

// Telling a queue that is in line with the definitions from one an older build created with other bounds (E07-S05).

const WANTED: QueueSettings = { policy: 'standard', ...EXPECTED_BOUNDS, deadLetter: 'job-dead-letter' };
const IN_LINE = { name: 'sweep', policy: 'standard', ...EXPECTED_BOUNDS, deadLetter: 'job-dead-letter' };

test('a queue with the bounds and the dead-letter queue of the definition has not drifted', () => {
  expect(boundsDrifted(IN_LINE, WANTED)).toBe(false);
});

test.each([
  ['the retry limit', { retryLimit: 2 }],
  ['the retry delay', { retryDelay: 0 }],
  ['the backoff', { retryBackoff: false }],
  ['the expiry', { expireInSeconds: 900 }],
  ['the retention window', { retentionSeconds: 1 }],
  ['the deletion window', { deleteAfterSeconds: 1 }],
  ['the dead-letter queue', { deadLetter: 'another-queue' }],
])('a queue that differs in %s has drifted', (_what, change) => {
  expect(boundsDrifted({ ...IN_LINE, ...change }, WANTED)).toBe(true);
});

test('a queue pg-boss reports with no bounds at all, or with no dead-letter queue, has drifted', () => {
  expect(boundsDrifted({ name: 'sweep', policy: 'standard' }, WANTED)).toBe(true);
  expect(boundsDrifted({ ...IN_LINE, deadLetter: null }, WANTED)).toBe(true);
});

test('the dead-letter queue itself has not drifted with no dead-letter queue, whether pg-boss says null or nothing', () => {
  const wanted: QueueSettings = { policy: 'standard', ...EXPECTED_BOUNDS };
  expect(boundsDrifted({ name: 'job-dead-letter', ...EXPECTED_BOUNDS }, wanted)).toBe(false);
  expect(boundsDrifted({ name: 'job-dead-letter', ...EXPECTED_BOUNDS, deadLetter: null }, wanted)).toBe(false);
  expect(boundsDrifted({ name: 'job-dead-letter', ...EXPECTED_BOUNDS, deadLetter: 'sweep' }, wanted)).toBe(true);
});

test('an update carries the six bounds and the dead-letter queue, null to clear it, and never the policy', () => {
  expect(updateFor(WANTED)).toEqual({ ...EXPECTED_BOUNDS, deadLetter: 'job-dead-letter' });
  expect(updateFor({ policy: 'singleton', ...EXPECTED_BOUNDS })).toEqual({ ...EXPECTED_BOUNDS, deadLetter: null });
});
