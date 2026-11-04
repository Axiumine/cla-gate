// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, onTestFinished, test, vi } from 'vitest';
import { openPgliteDatabase } from './adapters/db/pglite.ts';
import { containing } from './adapters/db/test-support.ts';
import { MissingQueuesError } from './adapters/jobs/queue-check.ts';
import { QueuePolicyError } from './adapters/jobs/queue-policy.ts';
import { type BootOptions, boot } from './boot.ts';
import { captureLogs, FakeProcess, fakeJobQueue, freePort, UNREACHABLE_DATABASE_URL } from './test-support.ts';

// The job queue at boot (E07-S01): it starts after the database is open, a queue that cannot start stops the start with
// the reason in the log, and the queue is stopped with the app, before the database goes.

/** Boots on PGlite with the given queue starter, logging at `info` into memory; closed after the test. */
async function start(createJobQueue: BootOptions['createJobQueue'], env: Record<string, string> = {}) {
  const logs = captureLogs();
  const signals = new FakeProcess();
  const db = await openPgliteDatabase();
  const destroy = vi.spyOn(db, 'destroy');
  const server = await boot({
    env: {
      DATABASE_URL: UNREACHABLE_DATABASE_URL,
      HOST: '127.0.0.1',
      PORT: String(await freePort()),
      LOG_LEVEL: 'info',
      ...env,
    },
    signals,
    createDb: () => db,
    ...(createJobQueue === undefined ? {} : { createJobQueue }),
    logDestination: logs.destination,
  });
  onTestFinished(async () => {
    await server?.close();
  });
  return { server, signals, logs, destroy };
}

const fatal = (logs: ReturnType<typeof captureLogs>) => logs.lines().filter((line) => line['level'] === 60);

test('the queue is started once, with the configuration of the server', async () => {
  const queue = fakeJobQueue();
  const createJobQueue = vi.fn<NonNullable<BootOptions['createJobQueue']>>(() => Promise.resolve(queue));
  const { server } = await start(createJobQueue);
  expect(server).toBeDefined();
  expect(createJobQueue).toHaveBeenCalledOnce();
  expect(createJobQueue.mock.calls[0]?.[0].databaseUrl.reveal()).toBe(UNREACHABLE_DATABASE_URL);
});

test('readiness follows the queue', async () => {
  const queue = fakeJobQueue();
  const { server } = await start(() => Promise.resolve(queue));
  const ready = async () => (await fetch(`${server?.address}/readyz`)).status;
  expect(await ready()).toBe(200);
  queue.ready = false;
  expect(await ready()).toBe(503);
  queue.ready = true;
  expect(await ready()).toBe(200);
});

test('missing queues stop the start: they are named, the way out is said, the database is released, the exit code is 1', async () => {
  const { server, signals, logs, destroy } = await start(() =>
    Promise.reject(new MissingQueuesError(['close-pr', 'sweep'])),
  );
  expect(server).toBeUndefined();
  expect(signals.exitCode).toBe(1);
  expect(destroy).toHaveBeenCalledOnce();
  expect(fatal(logs)).toMatchObject([
    { queues: ['close-pr', 'sweep'], msg: 'Job queues are missing: close-pr, sweep: run yarn db:migrate' },
  ]);
  expect(signals.listenerCount('SIGTERM')).toBe(0);
});

test('a queue of the wrong policy stops the start: queue and policies are named, and the way out is said', async () => {
  const mismatches = [{ queue: 'evaluate-pr', found: 'standard', expected: 'singleton' }] as const;
  const { server, signals, logs } = await start(() => Promise.reject(new QueuePolicyError(mismatches)));
  expect(server).toBeUndefined();
  expect(signals.exitCode).toBe(1);
  expect(fatal(logs)).toMatchObject([
    {
      mismatches: [{ queue: 'evaluate-pr', found: 'standard', expected: 'singleton' }],
      msg: containing('evaluate-pr is standard, not singleton'),
    },
  ]);
});

test('a queue that cannot start for another reason stops the start with that error in the log', async () => {
  const { server, signals, logs } = await start(() => Promise.reject(new Error('pg-boss is not installed')));
  expect(server).toBeUndefined();
  expect(signals.exitCode).toBe(1);
  expect(fatal(logs)).toMatchObject([{ msg: 'jobs.queue_start_failed', err: { message: 'pg-boss is not installed' } }]);
});

test('by default pg-boss starts on DATABASE_URL: an unreachable database stops the start, and the password stays out of the log', async () => {
  const { server, signals, logs } = await start(undefined);
  expect(server).toBeUndefined();
  expect(signals.exitCode).toBe(1);
  expect(fatal(logs)).toMatchObject([{ msg: 'jobs.queue_start_failed' }]);
  expect(logs.text()).not.toContain('user:pw');
});

test('the queue is stopped with the app, before the database is closed', async () => {
  const queue = fakeJobQueue();
  const stop = vi.spyOn(queue, 'stop');
  const { server, destroy } = await start(() => Promise.resolve(queue));
  await server?.close();
  expect(stop).toHaveBeenCalledOnce();
  expect(destroy).toHaveBeenCalledOnce();
  expect(stop.mock.invocationCallOrder[0]).toBeLessThan(destroy.mock.invocationCallOrder[0] ?? 0);
});

test('a port that is taken stops the queue that was started', async () => {
  const first = await start(() => Promise.resolve(fakeJobQueue()));
  const queue = fakeJobQueue();
  const second = await start(() => Promise.resolve(queue), { PORT: new URL(first.server?.address ?? '').port });
  expect(second.server).toBeUndefined();
  expect(queue.stops).toBe(1);
});

test('the queue is given the handlers, the delivery marker, the clock and the concurrency of the server to work the jobs with (E07-S03)', async () => {
  const createJobQueue = vi.fn<NonNullable<BootOptions['createJobQueue']>>(() => Promise.resolve(fakeJobQueue()));
  await start(createJobQueue, { WORKER_CONCURRENCY: '6' });
  const workers = createJobQueue.mock.calls[0]?.[2];
  expect(workers?.concurrency).toBe(6);
  expect(workers?.registry.types()).toContain('sync-installation');
  expect(workers?.registry.types()).not.toContain('revoke-user-sessions');
  expect(workers?.registry.types()).toContain('sweep-repository');
  expect(workers?.registry.types()).toContain('finalise-repository');
  expect(workers?.registry.types()).toContain('finalise-check');
  expect(typeof workers?.markDeliveryProcessed).toBe('function');
  expect(workers?.clock.now()).toBeInstanceOf(Date);
});

test('a shutdown that drained the running jobs leaves the exit code at 0 (E07-S03)', async () => {
  const queue = fakeJobQueue();
  const { server, signals, logs } = await start(() => Promise.resolve(queue));
  signals.emit('SIGTERM');
  await server?.close();
  expect(queue.stops).toBe(1);
  expect(signals.exitCode).toBeUndefined();
  expect(logs.lines().filter((line) => line['level'] === 50)).toEqual([]);
});

test('a shutdown that had to abort running jobs logs it and ends with exit code 1 (E07-S03)', async () => {
  const queue = fakeJobQueue();
  queue.stopOutcome = 'aborted';
  const { server, signals, logs } = await start(() => Promise.resolve(queue));
  signals.emit('SIGINT');
  await server?.close();
  expect(queue.stops).toBe(1);
  expect(signals.exitCode).toBe(1);
  expect(logs.lines().filter((line) => line['level'] === 50)).toMatchObject([
    { msg: 'jobs still running at the end of the grace period were aborted, and run again after a restart' },
  ]);
});
