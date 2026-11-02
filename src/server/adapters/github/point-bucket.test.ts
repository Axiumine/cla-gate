// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { PointBucket } from './point-bucket.ts';

// 900 points a minute is 15 a second, or one every 66.67 ms.

test('points within the capacity cost no wait', () => {
  const bucket = new PointBucket(900, 900, 0);
  expect(bucket.take(900, 0)).toBe(0);
});

test('a point past the capacity waits for its refill, and the debt of the ones before it counts', () => {
  const bucket = new PointBucket(900, 900, 0);
  bucket.take(900, 0);
  expect([bucket.take(1, 0), bucket.take(1, 0), bucket.take(5, 0)]).toEqual([67, 134, 467]);
});

test('points come back with time, at 900 a minute', () => {
  const bucket = new PointBucket(900, 900, 0);
  bucket.take(900, 0);
  expect(bucket.take(15, 1000)).toBe(0);
  expect(bucket.take(15, 1000)).toBe(1000);
});

test('the bucket never holds more than its capacity, however long it rests', () => {
  const bucket = new PointBucket(900, 900, 0);
  bucket.take(100, 0);
  expect(bucket.isFull(60_000)).toBe(true);
  expect(bucket.take(1000, 3_600_000)).toBe(6667);
});

test('it is full when every point is back, not before', () => {
  const bucket = new PointBucket(900, 900, 0);
  expect(bucket.isFull(0)).toBe(true);
  bucket.take(15, 0);
  expect(bucket.isFull(999)).toBe(false);
  expect(bucket.isFull(1000)).toBe(true);
});

test('a clock that steps back gives nothing and takes nothing', () => {
  const bucket = new PointBucket(900, 900, 10_000);
  bucket.take(900, 10_000);
  expect(bucket.take(1, 5_000)).toBe(67);
  expect(bucket.take(1, 10_000)).toBe(134);
});
