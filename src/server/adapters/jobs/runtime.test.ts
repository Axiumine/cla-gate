// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { captureLogs, testConfig } from '../../test-support.ts';
import { createLogger } from '../http/logger.ts';
import { PgBossEnqueuer } from './enqueuer.ts';
import { MissingQueuesError } from './queue-check.ts';
import { QueuePolicyError } from './queue-policy.ts';
import { QUEUE_DEFINITIONS, QUEUES } from './queues.ts';
import { type StartJobQueueOptions, startJobQueue } from './runtime.ts';
import { fakeBoss } from './test-support.ts';

// The runtime queue with a pg-boss that is only a script (E07-S01). Against a real server: queue-real.test.ts.

// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_password -- made-up value: the tests prove that the password never reaches the log
const URL_WITH_PASSWORD = 'postgres://cla_app:made-up-pw@127.0.0.1:1/cla';

function start(boss = fakeBoss()) {
  const logs = captureLogs();
  const logger = createLogger(testConfig(), logs.destination);
  const createBoss = vi.fn<NonNullable<StartJobQueueOptions['createBoss']>>(() => boss);
  return { boss, logs, createBoss, queue: startJobQueue({ connectionString: URL_WITH_PASSWORD, logger, createBoss }) };
}

test('it starts pg-boss with the options of the runtime role, then checks the queues', async () => {
  const { boss, createBoss, queue } = start();
  await queue;
  expect(createBoss).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ migrate: false, createSchema: false }));
  expect(createBoss.mock.calls[0]?.[0]).toMatchObject({ connectionString: URL_WITH_PASSWORD, schema: 'pgboss' });
  expect(boss.start.mock.invocationCallOrder[0]).toBeLessThan(boss.getQueues.mock.invocationCallOrder[0] ?? 0);
});

test('it hands out the pg-boss enqueuer', async () => {
  expect((await start().queue).enqueuer).toBeInstanceOf(PgBossEnqueuer);
});

test('a missing queue stops pg-boss and fails with the names of the missing ones', async () => {
  const boss = fakeBoss();
  boss.getQueues.mockResolvedValueOnce([{ name: 'evaluate-pr' }]);
  const { queue } = start(boss);
  const error = await queue.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(MissingQueuesError);
  expect(error).toMatchObject({ queues: QUEUES.filter((name) => name !== 'evaluate-pr') });
  expect(boss.stop).toHaveBeenCalledOnce();
});

test('a queue of the wrong policy stops pg-boss and fails with the queue and the policy it has (E07-S02)', async () => {
  const boss = fakeBoss();
  boss.getQueues.mockResolvedValueOnce(
    QUEUE_DEFINITIONS.map(({ name, policy }) => ({ name, policy: name === 'evaluate-pr' ? 'standard' : policy })),
  );
  const error = await start(boss).queue.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(QueuePolicyError);
  expect(error).toMatchObject({ mismatches: [{ queue: 'evaluate-pr', found: 'standard', expected: 'singleton' }] });
  expect(boss.stop).toHaveBeenCalledOnce();
});

test('a start that fails (the schema is not installed, the database is down) stops pg-boss and throws that error', async () => {
  const boss = fakeBoss();
  const failure = new Error('pg-boss is not installed');
  boss.start.mockRejectedValueOnce(failure);
  await expect(start(boss).queue).rejects.toBe(failure);
  expect(boss.stop).toHaveBeenCalledOnce();
  expect(boss.getQueues).not.toHaveBeenCalled();
});

test('a stop that also fails does not hide the error that stopped the start', async () => {
  const boss = fakeBoss();
  const failure = new Error('connection refused');
  boss.start.mockRejectedValueOnce(failure);
  boss.stop.mockRejectedValueOnce(new Error('stop failed'));
  await expect(start(boss).queue).rejects.toBe(failure);
});

test('an error event of pg-boss is logged once with its error, and never the connection string', async () => {
  const { boss, logs, queue } = start();
  await queue;
  boss.emitError(Object.assign(new Error('connection terminated'), { code: '57P01' }));
  const lines = logs.lines().filter((line) => line['msg'] === 'jobs.queue_error');
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ level: 50 });
  expect(logs.text()).not.toContain('made-up-pw');
});

test('the queue is ready until pg-boss reports an error, and again when the queues can be read', async () => {
  const { boss, queue } = start();
  const running = await queue;
  expect(await running.isReady()).toBe(true);
  boss.emitError(new Error('connection terminated'));
  boss.getQueues.mockRejectedValueOnce(new Error('still down'));
  expect(await running.isReady()).toBe(false);
  boss.getQueues.mockResolvedValueOnce([{ name: 'evaluate-pr' }]);
  expect(await running.isReady()).toBe(false);
  expect(await running.isReady()).toBe(true);
  expect(boss.getQueues).toHaveBeenCalledTimes(4);
});

test('a queue that is ready costs no read: the queues are read only after an error', async () => {
  const { boss, queue } = start();
  const running = await queue;
  await running.isReady();
  await running.isReady();
  expect(boss.getQueues).toHaveBeenCalledOnce();
});

test('an error that arrives while the queues are being read is not cleared by that read', async () => {
  const { boss, queue } = start();
  const running = await queue;
  boss.emitError(new Error('first'));
  const read = Promise.withResolvers<{ name: string }[]>();
  boss.getQueues.mockReturnValueOnce(read.promise);
  const ready = running.isReady();
  boss.emitError(new Error('second'));
  read.resolve(QUEUES.map((name) => ({ name })));
  expect(await ready).toBe(false);
});

test('stop stops pg-boss once however often it is called, and the queue is not ready afterwards', async () => {
  const { boss, queue } = start();
  const running = await queue;
  await Promise.all([running.stop(), running.stop()]);
  await running.stop();
  expect(boss.stop).toHaveBeenCalledOnce();
  expect(await running.isReady()).toBe(false);
});
