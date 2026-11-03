// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { setTimeout as sleep } from 'node:timers/promises';
import { expect, test } from 'vitest';
import { captureLogs, testConfig } from '../../test-support.ts';
import { createLogger } from '../http/logger.ts';
import {
  failOnUnhandledRejection,
  installRejectionGuard,
  onUnhandledRejection,
  rejectionGuardUsers,
} from './rejection-guard.ts';

// The guard that keeps an unhandled rejection of a job's code from stopping the process (E07-S03). The listener is called
// directly: a real unhandled rejection would reach the listeners of the test runner as well. The real thing, in a worker over a
// real queue, is in workers-real.test.ts.

/** A logger and the lines it wrote. */
function capturedLogger() {
  const logs = captureLogs();
  return { logger: createLogger(testConfig(), logs.destination), lines: () => logs.lines() };
}

test('a job that settles settles the same way through the guard', async () => {
  const { logger } = capturedLogger();
  await expect(failOnUnhandledRejection(logger, () => Promise.resolve('done'))).resolves.toBe('done');
  const failure = new Error('the handler threw');
  await expect(failOnUnhandledRejection(logger, () => Promise.reject(failure))).rejects.toBe(failure);
});

test('a rejection that nobody waits for, raised while the job runs, fails that job and is logged', async () => {
  const { logger, lines } = capturedLogger();
  const floating = new Error('the promise nobody waited for');
  const job = failOnUnhandledRejection(logger, async () => {
    onUnhandledRejection(floating);
    await sleep(20);
    return 'finished late';
  });
  await expect(job).rejects.toBe(floating);
  expect(lines()).toMatchObject([{ level: 50, msg: 'job.unhandled_rejection' }]);
});

test('the job is found from a timer the handler started: the async context follows callbacks', async () => {
  const job = failOnUnhandledRejection(
    capturedLogger().logger,
    () =>
      new Promise<never>(() => {
        setTimeout(() => {
          onUnhandledRejection(new Error('from a timer'));
        }, 5);
      }),
  );
  await expect(job).rejects.toThrow('from a timer');
});

test('two jobs at once: the rejection fails the job it came from and not the other, and is logged on its logger', async () => {
  const bad = capturedLogger();
  const good = capturedLogger();
  const settled = await Promise.allSettled([
    failOnUnhandledRejection(bad.logger, async () => {
      await sleep(5);
      onUnhandledRejection(new Error('only this one'));
      await sleep(40);
    }),
    failOnUnhandledRejection(good.logger, async () => {
      await sleep(20);
      return 'good';
    }),
  ]);
  expect(settled).toMatchObject([
    { status: 'rejected', reason: { message: 'only this one' } },
    { status: 'fulfilled', value: 'good' },
  ]);
  expect(bad.lines()).toHaveLength(1);
  expect(good.lines()).toEqual([]);
});

test('a rejection that comes after the job settled is logged and changes nothing', async () => {
  const { logger, lines } = capturedLogger();
  const job = failOnUnhandledRejection(logger, () => {
    setTimeout(() => {
      onUnhandledRejection(new Error('too late'));
    }, 5);
    return Promise.resolve('done');
  });
  await expect(job).resolves.toBe('done');
  await sleep(30);
  expect(lines()).toMatchObject([{ msg: 'job.unhandled_rejection' }]);
});

test("a rejection that is no job's is thrown again, which stops the process as it would without the guard", () => {
  const failure = new Error("nobody's");
  expect(() => {
    onUnhandledRejection(failure);
  }).toThrow(failure);
  expect(() => {
    onUnhandledRejection(42);
  }).toThrow('unhandled rejection: 42');
});

test('the process has one listener however many queues use the guard, and has none after the last has released it', () => {
  const users = rejectionGuardUsers();
  const listeners = () =>
    process.listeners('unhandledRejection').filter((listener) => listener === onUnhandledRejection);
  const first = installRejectionGuard();
  const second = installRejectionGuard();
  expect(rejectionGuardUsers()).toBe(users + 2);
  expect(listeners()).toHaveLength(1);
  first();
  first();
  expect(rejectionGuardUsers()).toBe(users + 1);
  expect(listeners()).toHaveLength(1);
  second();
  expect(rejectionGuardUsers()).toBe(users);
  expect(listeners()).toHaveLength(users === 0 ? 0 : 1);
});
