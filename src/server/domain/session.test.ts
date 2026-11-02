// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { isLive, needsTouch, newTimes, type SessionLimits, slide } from './session.ts';

// The lifetime rules of E10-S01. Time is milliseconds since the epoch: the domain has no clock.

const LIMITS: SessionLimits = { idleSeconds: 28_800, absoluteSeconds: 604_800 };
const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;

test('a new session idles for the configured seconds and lives for the configured absolute seconds', () => {
  expect(newTimes(NOW, LIMITS)).toEqual({ idleExpiresAt: NOW + 28_800_000, absoluteExpiresAt: NOW + 604_800_000 });
});

test('a new session never idles past its absolute expiry, even when the two limits are equal', () => {
  const times = newTimes(NOW, { idleSeconds: 300, absoluteSeconds: 300 });
  expect(times.idleExpiresAt).toBe(times.absoluteExpiresAt);
});

test.each([
  ['one millisecond before the idle expiry', NOW + 28_800_000 - 1, true],
  ['exactly at the idle expiry', NOW + 28_800_000, false],
  ['one millisecond after the idle expiry', NOW + 28_800_000 + 1, false],
  ['long before', NOW, true],
])('a session is live %s: %s', (_label, now, live) => {
  expect(isLive({ idleExpiresAt: NOW + 28_800_000, absoluteExpiresAt: NOW + 604_800_000 }, now)).toBe(live);
});

test.each([
  ['one millisecond before the absolute expiry', NOW + 1000 - 1, true],
  ['exactly at the absolute expiry', NOW + 1000, false],
  ['one millisecond after the absolute expiry', NOW + 1000 + 1, false],
])('a session whose idle expiry equals its absolute one is live %s: %s', (_label, now, live) => {
  expect(isLive({ idleExpiresAt: NOW + 1000, absoluteExpiresAt: NOW + 1000 }, now)).toBe(live);
});

test('a session that is absolute-expired is dead whatever its idle expiry says', () => {
  // Not a state the table allows (idle <= absolute), but the rule must not depend on it.
  expect(isLive({ idleExpiresAt: NOW + HOUR, absoluteExpiresAt: NOW }, NOW)).toBe(false);
});

test('sliding moves the idle expiry to now plus the idle limit and leaves the absolute expiry alone', () => {
  const times = newTimes(NOW, LIMITS);
  const later = NOW + 2 * HOUR;
  expect(slide(times, later, LIMITS)).toEqual({
    idleExpiresAt: later + 28_800_000,
    absoluteExpiresAt: times.absoluteExpiresAt,
  });
});

test.each([
  ['an hour before the absolute expiry', 604_800_000 - HOUR],
  ['one millisecond before the absolute expiry', 604_800_000 - 1],
  ['exactly at the absolute expiry', 604_800_000],
  ['after the absolute expiry', 604_800_000 + HOUR],
])('sliding %s never goes past the absolute expiry', (_label, elapsed) => {
  const times = newTimes(NOW, LIMITS);
  const slid = slide(times, NOW + elapsed, LIMITS);
  expect(slid.idleExpiresAt).toBe(times.absoluteExpiresAt);
  expect(slid.idleExpiresAt).toBeLessThanOrEqual(slid.absoluteExpiresAt);
});

test('sliding keeps the idle expiry below the absolute one at every point of a long session', () => {
  const times = newTimes(NOW, LIMITS);
  for (let elapsed = 0; elapsed <= 604_800_000; elapsed += 6 * HOUR) {
    const slid = slide(times, NOW + elapsed, LIMITS);
    expect(slid.idleExpiresAt).toBeLessThanOrEqual(times.absoluteExpiresAt);
    expect(slid.idleExpiresAt).toBe(Math.min(NOW + elapsed + 28_800_000, times.absoluteExpiresAt));
  }
});

test.each([
  ['just seen', 0, false],
  ['59 seconds ago', 59_000, false],
  ['one millisecond under 60 seconds ago', MINUTE - 1, false],
  ['exactly 60 seconds ago', MINUTE, false],
  ['one millisecond over 60 seconds ago', MINUTE + 1, true],
  ['an hour ago', HOUR, true],
  ['in the future (a clock that stepped back)', -HOUR, false],
])('a session seen %s needs a touch: %s', (_label, elapsed, due) => {
  expect(needsTouch(NOW - elapsed, NOW)).toBe(due);
});
