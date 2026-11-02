// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { gate } from './limiter-fixture/test-support.ts';
import { Semaphore } from './semaphore.ts';

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

test('at most `limit` runs are going at once, the rest wait for a place', async () => {
  const semaphore = new Semaphore(2);
  const gates = [gate(), gate(), gate(), gate()];
  let going = 0;
  let peak = 0;
  const runs = gates.map((entry) =>
    semaphore.run(async () => {
      going += 1;
      peak = Math.max(peak, going);
      await entry.promise;
      going -= 1;
    }),
  );
  await tick();
  expect(going).toBe(2);
  gates[0]?.open();
  await tick();
  expect(going).toBe(2);
  for (const entry of gates) {
    entry.open();
  }
  await Promise.all(runs);
  expect([peak, going]).toEqual([2, 0]);
});

test('runs start in the order they asked', async () => {
  const semaphore = new Semaphore(1);
  const order: number[] = [];
  const first = gate();
  const runs = [0, 1, 2, 3].map((n) =>
    semaphore.run(async () => {
      order.push(n);
      if (n === 0) {
        await first.promise;
      }
    }),
  );
  await tick();
  expect(order).toEqual([0]);
  first.open();
  await Promise.all(runs);
  expect(order).toEqual([0, 1, 2, 3]);
});

test("a run that fails gives its place back, and the failure is the caller's", async () => {
  const semaphore = new Semaphore(1);
  const failed = semaphore.run(() => Promise.reject(new Error('boom')));
  const next = semaphore.run(() => Promise.resolve('after'));
  await expect(failed).rejects.toThrow('boom');
  expect(await next).toBe('after');
});
