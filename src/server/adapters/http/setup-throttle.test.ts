// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { FakeClock } from '../../services/test-support.ts';
import { createUnlockThrottle, UNLOCK_LIMITS } from './setup-throttle.ts';

// E19-S06: five wrong tokens per minute per client address and thirty per ten minutes for the whole server.

const SECOND = 1000;
const MINUTE = 60 * SECOND;

function throttleOnClock() {
  const clock = new FakeClock('2026-11-03T09:00:00.000Z');
  return { clock, throttle: createUnlockThrottle(clock) };
}

test('the limits are the ones of the story, spelled out here on purpose', () => {
  expect(UNLOCK_LIMITS).toEqual({
    perAddress: { failures: 5, windowMs: 60_000 },
    overall: { failures: 30, windowMs: 600_000 },
  });
});

test('an address is free until it has failed five times, and held back from then on', () => {
  const { throttle } = throttleOnClock();
  for (let failure = 1; failure <= 5; failure += 1) {
    expect(throttle.retryAfter('203.0.113.7')).toBeUndefined();
    throttle.recordFailure('203.0.113.7');
  }
  expect(throttle.retryAfter('203.0.113.7')).toBe(60);
});

test('nothing is held back before any failure, and failures of another address do not hold this one', () => {
  const { throttle } = throttleOnClock();
  expect(throttle.retryAfter('203.0.113.7')).toBeUndefined();
  for (let failure = 1; failure <= 5; failure += 1) {
    throttle.recordFailure('203.0.113.8');
  }
  expect(throttle.retryAfter('203.0.113.7')).toBeUndefined();
  expect(throttle.retryAfter('203.0.113.8')).toBe(60);
});

test('the wait shrinks with the clock and ends when the oldest of the five failures leaves the minute', () => {
  const { clock, throttle } = throttleOnClock();
  for (let failure = 1; failure <= 5; failure += 1) {
    throttle.recordFailure('203.0.113.7');
  }
  clock.advance(20 * SECOND);
  expect(throttle.retryAfter('203.0.113.7')).toBe(40);
  clock.advance(500);
  expect(throttle.retryAfter('203.0.113.7')).toBe(40);
  clock.advance(38 * SECOND + 500);
  expect(throttle.retryAfter('203.0.113.7')).toBe(1);
  clock.advance(SECOND);
  expect(throttle.retryAfter('203.0.113.7')).toBeUndefined();
});

test('failures spread over more than a minute never add up to five in one minute', () => {
  const { clock, throttle } = throttleOnClock();
  for (let failure = 1; failure <= 12; failure += 1) {
    throttle.recordFailure('203.0.113.7');
    clock.advance(15 * SECOND);
    expect(throttle.retryAfter('203.0.113.7')).toBeUndefined();
  }
});

test('thirty failures from thirty addresses hold everyone back for ten minutes, a new address included', () => {
  const { clock, throttle } = throttleOnClock();
  for (let address = 1; address <= 29; address += 1) {
    throttle.recordFailure(`198.51.100.${address}`);
  }
  expect(throttle.retryAfter('192.0.2.1')).toBeUndefined();
  throttle.recordFailure('198.51.100.30');
  expect(throttle.retryAfter('192.0.2.1')).toBe(600);
  clock.advance(10 * MINUTE - SECOND);
  expect(throttle.retryAfter('192.0.2.1')).toBe(1);
  clock.advance(SECOND);
  expect(throttle.retryAfter('192.0.2.1')).toBeUndefined();
});

test("the wait of an address is the longer of its own and the server's", () => {
  const { clock, throttle } = throttleOnClock();
  for (let address = 1; address <= 25; address += 1) {
    throttle.recordFailure(`198.51.100.${address}`);
  }
  clock.advance(9 * MINUTE + 30 * SECOND);
  for (let failure = 1; failure <= 5; failure += 1) {
    throttle.recordFailure('203.0.113.7');
  }
  // The server has 30 failures in ten minutes and its oldest leaves in 30 s; the address has 5 in a minute and its oldest leaves in 60 s.
  expect(throttle.retryAfter('192.0.2.1')).toBe(30);
  expect(throttle.retryAfter('203.0.113.7')).toBe(60);
});
