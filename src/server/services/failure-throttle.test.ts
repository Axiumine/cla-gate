// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { createFailureThrottle, type FailureThrottle, SIGNATURE_FAILURE_LIMITS } from './failure-throttle.ts';
import { FakeClock } from './test-support.ts';

// "More than 30 failures from one address within 60 seconds are held back until the window slides, and the memory is
// bounded at 10,000 addresses, least recently used first" (E06-S07).

const SECOND = 1000;
const START = '2026-06-01T12:00:00Z';

function throttleOf(limits: Partial<Record<keyof typeof SIGNATURE_FAILURE_LIMITS, number>> = {}) {
  const clock = new FakeClock(START);
  const throttle = createFailureThrottle({ clock, ...SIGNATURE_FAILURE_LIMITS, ...limits });
  return { clock, throttle };
}

/** Records `count` failures of `key`, `gapMs` apart, and returns what the last one was told. */
function fail(
  { clock, throttle }: { clock: FakeClock; throttle: FailureThrottle },
  key: string,
  count: number,
  gapMs = 0,
): number | undefined {
  let last: number | undefined;
  for (let index = 0; index < count; index += 1) {
    if (index > 0) {
      clock.advance(gapMs);
    }
    last = throttle.recordFailure(key);
  }
  return last;
}

test('the limits are 30 failures in 60 seconds and 10,000 addresses', () => {
  expect(SIGNATURE_FAILURE_LIMITS).toEqual({ maxFailures: 30, windowMs: 60_000, maxKeys: 10_000 });
});

test('30 failures are within the limit: not one of them, and nothing after them, is held back', () => {
  const world = throttleOf();
  expect(fail(world, '203.0.113.7', 30)).toBeUndefined();
  expect(world.throttle.retryAfter('203.0.113.7')).toBeUndefined();
});

test('the 31st failure within the window holds the address back for the whole window, in whole seconds', () => {
  const world = throttleOf();
  expect(fail(world, '203.0.113.7', 31)).toBe(60);
  expect(world.throttle.retryAfter('203.0.113.7')).toBe(60);
});

test('the wait shrinks as the window slides and ends exactly when the failure that counts leaves it', () => {
  const world = throttleOf();
  expect(fail(world, '203.0.113.7', 31, SECOND)).toBe(30);
  world.clock.advance(29 * SECOND);
  expect(world.throttle.retryAfter('203.0.113.7')).toBe(1);
  world.clock.advance(SECOND - 1);
  expect(world.throttle.retryAfter('203.0.113.7')).toBe(1);
  world.clock.advance(1);
  expect(world.throttle.retryAfter('203.0.113.7')).toBeUndefined();
});

test('a partial second rounds up, so Retry-After is never an early release', () => {
  const world = throttleOf();
  fail(world, '203.0.113.7', 31);
  world.clock.advance(59_500);
  expect(world.throttle.retryAfter('203.0.113.7')).toBe(1);
});

test('failures spread out never add up: 30 a minute for ever is never held back', () => {
  const world = throttleOf();
  for (let minute = 0; minute < 5; minute += 1) {
    expect(fail(world, '203.0.113.7', 30, SECOND)).toBeUndefined();
    world.clock.advance(31 * SECOND);
  }
  expect(world.throttle.retryAfter('203.0.113.7')).toBeUndefined();
});

test('only the last 31 failures count: a long run of failures is released 60 seconds after the 31st from the end', () => {
  const world = throttleOf();
  fail(world, '203.0.113.7', 100);
  world.clock.advance(60 * SECOND - 1);
  expect(world.throttle.retryAfter('203.0.113.7')).toBe(1);
  world.clock.advance(1);
  expect(world.throttle.retryAfter('203.0.113.7')).toBeUndefined();
});

test('an address that was released starts from a clean slate: it needs 31 new failures', () => {
  const world = throttleOf();
  fail(world, '203.0.113.7', 31);
  world.clock.advance(60 * SECOND);
  expect(fail(world, '203.0.113.7', 30)).toBeUndefined();
  expect(world.throttle.recordFailure('203.0.113.7')).toBe(60);
});

test('asking does not count: an address that only asks is never held back', () => {
  const world = throttleOf();
  for (let asked = 0; asked < 100; asked += 1) {
    expect(world.throttle.retryAfter('203.0.113.7')).toBeUndefined();
  }
  expect(fail(world, '203.0.113.7', 30)).toBeUndefined();
});

test('addresses are independent: one that is held back does not hold back another', () => {
  const world = throttleOf();
  fail(world, '203.0.113.7', 31);
  expect(world.throttle.retryAfter('203.0.113.7')).toBe(60);
  expect(world.throttle.retryAfter('203.0.113.8')).toBeUndefined();
  expect(world.throttle.recordFailure('203.0.113.8')).toBeUndefined();
});

test('past the most addresses the one used longest ago is forgotten, held back or not', () => {
  const world = throttleOf({ maxFailures: 1, maxKeys: 2 });
  fail(world, 'a', 2);
  fail(world, 'b', 2);
  fail(world, 'c', 2);
  expect(world.throttle.retryAfter('a')).toBeUndefined();
  expect(world.throttle.retryAfter('b')).toBe(60);
  expect(world.throttle.retryAfter('c')).toBe(60);
});

test('asking about an address counts as using it: the one nobody touched is forgotten first', () => {
  const world = throttleOf({ maxFailures: 1, maxKeys: 2 });
  fail(world, 'a', 2);
  fail(world, 'b', 2);
  world.throttle.retryAfter('a');
  fail(world, 'c', 2);
  expect(world.throttle.retryAfter('a')).toBe(60);
  expect(world.throttle.retryAfter('b')).toBeUndefined();
});

test('asking about an address nobody has seen remembers nothing, so a scan cannot push the others out', () => {
  const world = throttleOf({ maxFailures: 1, maxKeys: 2 });
  fail(world, 'a', 2);
  fail(world, 'b', 2);
  for (let scanned = 0; scanned < 50; scanned += 1) {
    world.throttle.retryAfter(`scan-${scanned}`);
  }
  expect(world.throttle.retryAfter('a')).toBe(60);
  expect(world.throttle.retryAfter('b')).toBe(60);
});

test('with the real limits 10,001 addresses push the first out: its 31 failures are forgotten', () => {
  const world = throttleOf();
  fail(world, 'first', 31);
  expect(world.throttle.retryAfter('first')).toBe(60);
  for (let address = 0; address < SIGNATURE_FAILURE_LIMITS.maxKeys; address += 1) {
    world.throttle.recordFailure(`address-${address}`);
  }
  expect(world.throttle.retryAfter('first')).toBeUndefined();
  expect(world.throttle.retryAfter('address-0')).toBeUndefined();
  expect(world.throttle.retryAfter('address-9999')).toBeUndefined();
});
