// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import type { JobHandler } from '../../services/job-registry.ts';
import { completing, JOBS, runWorld } from '../../services/job-run-fixture/test-support.ts';
import { captureLogs, testConfig } from '../../test-support.ts';
import { createLogger } from '../http/logger.ts';
import { rejectionGuardUsers } from './rejection-guard.ts';
import { STOP_GRACE_MS, type StartJobQueueOptions, startJobQueue } from './runtime.ts';
import { fakeBoss } from './test-support.ts';
import type { WorkerWiring } from './workers.ts';

// The workers and the shutdown of the runtime queue (E07-S03), with a pg-boss that is only a script. Against a real
// server: workers-real.test.ts.

function start(options: { graceMs?: number; withWorkers?: boolean; handler?: JobHandler<'sync-installation'> } = {}) {
  const boss = fakeBoss();
  const logs = captureLogs();
  const logger = createLogger(testConfig(), logs.destination);
  const { deps } = runWorld((registry) => {
    registry.register('sync-installation', options.handler ?? completing());
  });
  const workers: WorkerWiring = { ...deps, concurrency: 3 };
  const createBoss = vi.fn<NonNullable<StartJobQueueOptions['createBoss']>>(() => boss);
  const queue = startJobQueue({
    connectionString: 'postgres://cla_app:made-up@127.0.0.1:1/cla',
    logger,
    createBoss,
    ...(options.withWorkers === false ? {} : { workers }),
    ...(options.graceMs === undefined ? {} : { graceMs: options.graceMs }),
  });
  return { boss, queue, logs };
}

test('the workers start after pg-boss started and the queues were checked, with the concurrency of the wiring', async () => {
  const { boss, queue } = start();
  await queue;
  expect(boss.work).toHaveBeenCalledOnce();
  expect(boss.work.mock.calls[0]?.[0]).toBe('sync-installation');
  expect(boss.work.mock.calls[0]?.[1]).toMatchObject({ localConcurrency: 3 });
  const order = (mock: { mock: { invocationCallOrder: number[] } }) => mock.mock.invocationCallOrder[0] ?? 0;
  expect(order(boss.start)).toBeLessThan(order(boss.getQueues));
  expect(order(boss.getQueues)).toBeLessThan(order(boss.work));
});

test('without workers the queue only sends: nothing is worked and a stop is a drain', async () => {
  const { boss, queue } = start({ withWorkers: false });
  const running = await queue;
  expect(boss.work).not.toHaveBeenCalled();
  expect(await running.stop()).toBe('drained');
});

test('workers are not started on a database that lacks a queue: pg-boss is stopped and the start fails', async () => {
  const boss = fakeBoss();
  boss.getQueues.mockResolvedValueOnce([{ name: 'evaluate-pr' }]);
  const { deps } = runWorld((registry) => {
    registry.register('sync-installation', completing());
  });
  const failed = startJobQueue({
    connectionString: 'postgres://cla_app:made-up@127.0.0.1:1/cla',
    logger: createLogger(testConfig(), captureLogs().destination),
    createBoss: () => boss,
    workers: { ...deps, concurrency: 1 },
  });
  await expect(failed).rejects.toThrow('Job queues are missing');
  expect(boss.work).not.toHaveBeenCalled();
  expect(boss.stop).toHaveBeenCalledOnce();
});

test('a worker that cannot start stops pg-boss and fails the start with its error', async () => {
  const boss = fakeBoss();
  boss.work.mockRejectedValueOnce(new Error('queue does not exist'));
  const { deps } = runWorld((registry) => {
    registry.register('sync-installation', completing());
  });
  const failed = startJobQueue({
    connectionString: 'postgres://cla_app:made-up@127.0.0.1:1/cla',
    logger: createLogger(testConfig(), captureLogs().destination),
    createBoss: () => boss,
    workers: { ...deps, concurrency: 1 },
  });
  await expect(failed).rejects.toThrow('queue does not exist');
  expect(boss.stop).toHaveBeenCalledOnce();
});

test('a stop is graceful and waits for the running jobs for 30 s before it aborts them', async () => {
  const { boss, queue } = start();
  await (await queue).stop();
  expect(STOP_GRACE_MS).toBe(30_000);
  expect(boss.stop).toHaveBeenCalledExactlyOnceWith({ graceful: true, timeout: 30_000 });
});

test('the grace period can be shortened for a test', async () => {
  const { boss, queue } = start({ graceMs: 1500 });
  await (await queue).stop();
  expect(boss.stop).toHaveBeenCalledExactlyOnceWith({ graceful: true, timeout: 1500 });
});

test('a stop with every job finished is drained', async () => {
  const { queue } = start();
  expect(await (await queue).stop()).toBe('drained');
});

const job = (signal = new AbortController().signal) => ({
  id: 'job-1',
  data: JOBS.syncInstallation,
  retryCount: 0,
  signal,
});

test('a job still running when pg-boss has stopped means the stop aborted it', async () => {
  const stuck = Promise.withResolvers<{ outcome: string }>();
  const { boss, queue } = start({ handler: () => stuck.promise });
  const running = await queue;
  const handling = boss.work.mock.calls[0]?.[2]([job()]);
  expect(await running.stop()).toBe('aborted');
  stuck.resolve({ outcome: 'late' });
  await handling;
});

test('a job that pg-boss aborted at the deadline and that stopped on its signal means the stop aborted it', async () => {
  const abort = new AbortController();
  const { boss, queue } = start({
    handler: (_job, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new Error('stopped on the signal'));
        });
      }),
  });
  const running = await queue;
  const handling = boss.work.mock.calls[0]?.[2]([job(abort.signal)]).catch(() => 'failed');
  boss.stop.mockImplementationOnce(async () => {
    abort.abort(new Error('pg-boss shut down while active'));
    await handling;
  });
  expect(await running.stop()).toBe('aborted');
  expect(await handling).toBe('failed');
});

test('every call of stop answers the outcome of the first, and pg-boss is stopped once', async () => {
  const { boss, queue } = start();
  const running = await queue;
  const outcomes = await Promise.all([running.stop(), running.stop()]);
  expect(outcomes).toEqual(['drained', 'drained']);
  expect(await running.stop()).toBe('drained');
  expect(boss.stop).toHaveBeenCalledOnce();
});

test('the jobs of the workers are the jobs of the wrapper: a job handed to the worker is run and settled', async () => {
  const { boss, queue } = start();
  await queue;
  expect(await boss.work.mock.calls[0]?.[2]([job()])).toEqual([
    { id: 'job-1', status: 'completed', output: { outcome: 'done' } },
  ]);
});

test('the guard against the unhandled rejections of jobs is in use while the workers run and not after the stop', async () => {
  const before = rejectionGuardUsers();
  const { queue } = start();
  const running = await queue;
  expect(rejectionGuardUsers()).toBe(before + 1);
  await running.stop();
  expect(rejectionGuardUsers()).toBe(before);
});

test('a queue without workers does not use the guard', async () => {
  const before = rejectionGuardUsers();
  const { queue } = start({ withWorkers: false });
  const running = await queue;
  expect(rejectionGuardUsers()).toBe(before);
  await running.stop();
});

test('a start that fails after the workers started stops guarding the process', async () => {
  const before = rejectionGuardUsers();
  const boss = fakeBoss();
  boss.work.mockResolvedValueOnce('worker-1').mockRejectedValueOnce(new Error('second queue does not exist'));
  const { deps } = runWorld((registry) => {
    registry.register('sync-installation', completing());
    registry.register('sweep', completing());
  });
  const failed = startJobQueue({
    connectionString: 'postgres://cla_app:made-up@127.0.0.1:1/cla',
    logger: createLogger(testConfig(), captureLogs().destination),
    createBoss: () => boss,
    workers: { ...deps, concurrency: 1 },
  });
  await expect(failed).rejects.toThrow('second queue does not exist');
  expect(rejectionGuardUsers()).toBe(before);
});
