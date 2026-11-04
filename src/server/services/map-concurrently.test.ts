// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { mapConcurrently } from './map-concurrently.ts';

test('the answers come in the order of the items, whichever finishes first', async () => {
  const answers = await mapConcurrently([30, 5, 20, 1], 2, async (milliseconds) => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
    return milliseconds * 2;
  });
  expect(answers).toEqual([60, 10, 40, 2]);
});

test('no more than the concurrency runs at once, and a group is started together', async () => {
  let running = 0;
  let most = 0;
  const started: number[] = [];
  await mapConcurrently([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
    started.push(item);
    running += 1;
    most = Math.max(most, running);
    await Promise.resolve();
    running -= 1;
  });
  expect(most).toBe(3);
  expect(started).toEqual([1, 2, 3, 4, 5, 6, 7]);
});

test('no items is no answers and no call', async () => {
  let calls = 0;
  expect(await mapConcurrently([], 4, () => Promise.resolve(++calls))).toEqual([]);
  expect(calls).toBe(0);
});

test('a failure is thrown, and the groups after the failing one are never started', async () => {
  const seen: number[] = [];
  const run = mapConcurrently([1, 2, 3, 4, 5, 6], 2, (item) => {
    seen.push(item);
    return item === 3 ? Promise.reject(new Error('third')) : Promise.resolve(item);
  });
  await expect(run).rejects.toThrow('third');
  expect(seen).toEqual([1, 2, 3, 4]);
});

test('the first failure of a group is the one thrown', async () => {
  const run = mapConcurrently([1, 2], 2, (item) => Promise.reject(new Error(`failed ${item}`)));
  await expect(run).rejects.toThrow('failed 1');
});

test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
  'a concurrency of %s is a RangeError, and nothing runs',
  async (concurrency) => {
    let calls = 0;
    await expect(mapConcurrently([1], concurrency, () => Promise.resolve(++calls))).rejects.toBeInstanceOf(RangeError);
    expect(calls).toBe(0);
  },
);
