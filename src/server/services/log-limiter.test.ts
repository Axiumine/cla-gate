// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { createLogLimiter } from './log-limiter.ts';
import { FakeClock } from './test-support.ts';

// "At most one log line per key per window" (E06-S05), with a bounded memory.

const MINUTE = 60_000;

function limiterOf(maxKeys = 100) {
  const clock = new FakeClock('2026-06-01T12:00:00Z');
  return { clock, limiter: createLogLimiter({ clock, windowMs: MINUTE, maxKeys }) };
}

test('the first call for a key is let through and the next ones in the window are not', () => {
  const { clock, limiter } = limiterOf();
  expect(limiter.allow(31_001)).toBe(true);
  expect(limiter.allow(31_001)).toBe(false);
  clock.advance(MINUTE - 1);
  expect(limiter.allow(31_001)).toBe(false);
});

test('the key is let through again when the window has passed, and the window starts anew', () => {
  const { clock, limiter } = limiterOf();
  limiter.allow(31_001);
  clock.advance(MINUTE);
  expect(limiter.allow(31_001)).toBe(true);
  clock.advance(MINUTE - 1);
  expect(limiter.allow(31_001)).toBe(false);
});

test('a refused call does not extend the window', () => {
  const { clock, limiter } = limiterOf();
  limiter.allow(31_001);
  clock.advance(MINUTE / 2);
  limiter.allow(31_001);
  clock.advance(MINUTE / 2);
  expect(limiter.allow(31_001)).toBe(true);
});

test('keys are independent: one installation does not hold back another', () => {
  const { limiter } = limiterOf();
  expect(limiter.allow(31_001)).toBe(true);
  expect(limiter.allow(31_002)).toBe(true);
  expect(limiter.allow(31_001)).toBe(false);
  expect(limiter.allow(31_002)).toBe(false);
});

test('past the most keys the one let through longest ago is forgotten, so memory is bounded', () => {
  const { limiter } = limiterOf(2);
  limiter.allow(1);
  limiter.allow(2);
  limiter.allow(3);
  expect(limiter.allow(1)).toBe(true);
  expect(limiter.allow(3)).toBe(false);
});

test('a key that is let through again moves to the back of the line', () => {
  const { clock, limiter } = limiterOf(2);
  limiter.allow(1);
  clock.advance(MINUTE);
  limiter.allow(2);
  limiter.allow(1);
  limiter.allow(3);
  expect(limiter.allow(1)).toBe(false);
  expect(limiter.allow(2)).toBe(true);
});

test('a clock that steps back holds the key back until time catches up, and never lets it through early', () => {
  const { clock, limiter } = limiterOf();
  limiter.allow(31_001);
  clock.advance(-10_000);
  expect(limiter.allow(31_001)).toBe(false);
});

test('a limiter that keeps no key lets every call through', () => {
  const { limiter } = limiterOf(0);
  expect(limiter.allow(1)).toBe(true);
  expect(limiter.allow(1)).toBe(true);
});
