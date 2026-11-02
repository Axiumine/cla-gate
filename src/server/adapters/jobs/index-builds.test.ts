// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { DEFAULT_INDEX_BUILD_WAIT, waitForIndexBuilds } from './index-builds.ts';
import { fakeBoss } from './test-support.ts';

const wait = (attempts: number) => ({ intervalMs: 250, attempts, sleep: vi.fn(() => Promise.resolve()) });

test('with no index build queued it returns at the first read, without sleeping', async () => {
  const boss = fakeBoss();
  const options = wait(5);
  await waitForIndexBuilds(boss, options);
  expect(boss.getBamStatus).toHaveBeenCalledOnce();
  expect(options.sleep).not.toHaveBeenCalled();
});

test('builds that are completed do not hold it', async () => {
  const boss = fakeBoss();
  boss.getBamStatus.mockResolvedValueOnce([{ status: 'completed', count: 12 }]);
  await waitForIndexBuilds(boss, wait(5));
  expect(boss.getBamStatus).toHaveBeenCalledOnce();
});

test('it waits, at the given interval, while a build is pending or running, and returns when the queue is empty', async () => {
  const boss = fakeBoss();
  boss.getBamStatus
    .mockResolvedValueOnce([{ status: 'pending', count: 2 }])
    .mockResolvedValueOnce([
      { status: 'completed', count: 1 },
      { status: 'in_progress', count: 1 },
    ])
    .mockResolvedValueOnce([{ status: 'completed', count: 3 }]);
  const options = wait(10);
  await waitForIndexBuilds(boss, options);
  expect(boss.getBamStatus).toHaveBeenCalledTimes(3);
  expect(options.sleep.mock.calls).toEqual([[250], [250]]);
});

test('a count that arrives as a string is read as a number', async () => {
  const boss = fakeBoss();
  boss.getBamStatus.mockResolvedValueOnce([{ status: 'pending', count: Number('1') }]).mockResolvedValueOnce([]);
  await waitForIndexBuilds(boss, wait(3));
  expect(boss.getBamStatus).toHaveBeenCalledTimes(2);
});

test('a failed build fails the wait, at once and even with builds still pending', async () => {
  const boss = fakeBoss();
  boss.getBamStatus.mockResolvedValueOnce([
    { status: 'failed', count: 1 },
    { status: 'pending', count: 1 },
  ]);
  const options = wait(5);
  await expect(waitForIndexBuilds(boss, options)).rejects.toThrow('a pg-boss index build failed');
  expect(options.sleep).not.toHaveBeenCalled();
});

test('builds that never finish fail the wait after the given number of reads, sleeping between them only', async () => {
  const boss = fakeBoss();
  boss.getBamStatus.mockResolvedValue([{ status: 'in_progress', count: 1 }]);
  const options = wait(3);
  await expect(waitForIndexBuilds(boss, options)).rejects.toThrow('did not finish in time: run yarn db:migrate again');
  expect(boss.getBamStatus).toHaveBeenCalledTimes(3);
  expect(options.sleep).toHaveBeenCalledTimes(2);
});

test('the default wait reads every second for half an hour and really sleeps', async () => {
  expect(DEFAULT_INDEX_BUILD_WAIT.intervalMs * DEFAULT_INDEX_BUILD_WAIT.attempts).toBe(30 * 60 * 1000);
  vi.useFakeTimers();
  try {
    const slept = DEFAULT_INDEX_BUILD_WAIT.sleep(1000);
    await vi.advanceTimersByTimeAsync(999);
    let done = false;
    void slept.then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await slept;
    expect(done).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
