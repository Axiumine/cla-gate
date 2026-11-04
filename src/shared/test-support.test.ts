// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { MOST_LINEAR_SLOWDOWN, SIZE_RATIO, slowdownOf } from './test-support.ts';

// `slowdownOf` replaces the bounds in seconds of the tests of the linear scans. Its tests run on a clock that the work itself
// advances, so they never wait for a real machine: what is checked is the arithmetic and what the work costs on each text.

const BYTES = 16_000;
const letters = (size: number): string => 'a'.repeat(size);

/** A clock that only `cost` moves: each call of the work adds `cost(size, call)` milliseconds, `call` counting the calls on that size. */
function clockOf(cost: (size: number, call: number) => number) {
  let time = 0;
  const callsOfSize = new Map<number, number>();
  return {
    now: () => time,
    work: (text: string): void => {
      const call = (callsOfSize.get(text.length) ?? 0) + 1;
      callsOfSize.set(text.length, call);
      time += cost(text.length, call);
    },
  };
}

test('the limit is between linear time, which is 1, and quadratic time, which is the size ratio', () => {
  expect(SIZE_RATIO).toBe(16);
  expect(MOST_LINEAR_SLOWDOWN).toBe(6);
});

test('each run is one pass over the large text and then the ratio of passes over the small one, on a clock read around each', () => {
  const events: string[] = [];
  let time = 0;
  slowdownOf(
    (text) => {
      events.push(String(text.length));
    },
    letters,
    BYTES,
    () => {
      events.push('read');
      time += 1;
      return time;
    },
  );
  const smalls = Array.from({ length: SIZE_RATIO }, () => '1000');
  const run = ['read', ...smalls, 'read', 'read', '16000', 'read'];
  expect(events).toEqual(Array.from({ length: 7 }, () => run).flat());
});

test('work that takes time in proportion to the size is a slowdown of exactly 1, which is within the limit', () => {
  const { now, work } = clockOf((size) => size / 1000);
  const slowdown = slowdownOf(work, letters, BYTES, now);
  expect(slowdown).toBe(1);
  expect(slowdown).toBeLessThan(MOST_LINEAR_SLOWDOWN);
});

test('work that takes time in proportion to the square of the size is a slowdown of the size ratio, above the limit', () => {
  const { now, work } = clockOf((size) => (size / 1000) ** 2);
  const slowdown = slowdownOf(work, letters, BYTES, now);
  expect(slowdown).toBe(SIZE_RATIO);
  expect(slowdown).toBeGreaterThan(MOST_LINEAR_SLOWDOWN);
});

/** The run a call belongs to: a run passes the large text once and each small text `SIZE_RATIO` times. */
const runOf = (size: number, call: number): number => (size === BYTES ? call : Math.ceil(call / SIZE_RATIO));

/** A clock on which every call of the work costs the size in milliseconds divided by 1000, except in run `slowRun`, where it costs 500 times that. */
const pausedIn = (slowRun: number) =>
  clockOf((size, call) => (size / 1000) * (runOf(size, call) === slowRun ? 500 : 1));

test('a run that is slow once, on either side, does not count: the fastest of the runs is compared', () => {
  for (const slowRun of [1, 3]) {
    const { now, work } = pausedIn(slowRun);
    expect(slowdownOf(work, letters, BYTES, now)).toBe(1);
  }
});

test('work faster than the clock can tell is not a division by zero', () => {
  expect(
    slowdownOf(
      () => undefined,
      letters,
      BYTES,
      () => 0,
    ),
  ).toBe(0);
});
