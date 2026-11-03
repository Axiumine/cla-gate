// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ConstructorOptions } from 'pg-boss';
import { expect, test, vi } from 'vitest';
import type { SweepInterval } from '../../domain/sweep.ts';
import { completing, runWorld } from '../../services/job-run-fixture/test-support.ts';
import { captureLogs, testConfig } from '../../test-support.ts';
import { createLogger } from '../http/logger.ts';
import { type StartJobQueueOptions, startJobQueue } from './runtime.ts';
import { fakeBoss } from './test-support.ts';

// The schedule of the reconciliation sweep at start-up (E07-S08), with a pg-boss that is only a script. Against a real server:
// sweep-schedule-real.test.ts.

function start(sweepIntervalMinutes: SweepInterval | undefined, withWorkers = true) {
  const boss = fakeBoss();
  const logs = captureLogs();
  const { deps } = runWorld((registry) => {
    registry.register('sync-installation', completing());
  });
  const createBoss = vi.fn<NonNullable<StartJobQueueOptions['createBoss']>>(() => boss);
  const queue = startJobQueue({
    connectionString: 'postgres://cla_app:made-up@127.0.0.1:1/cla',
    logger: createLogger(testConfig(), logs.destination),
    createBoss,
    ...(withWorkers ? { workers: { ...deps, concurrency: 2, sweepIntervalMinutes } } : {}),
  });
  return { boss, queue, logs, createBoss };
}

const schedulerOn = (createBoss: { mock: { calls: ConstructorOptions[][] } }) =>
  createBoss.mock.calls[0]?.[0]?.schedule;

test.each([5, 10, 15, 20, 30, 60] as const)(
  'an interval of %s minutes starts the timekeeper and schedules the sweep once the workers work',
  async (minutes) => {
    const { boss, queue, createBoss } = start(minutes);
    await queue;
    expect(schedulerOn(createBoss)).toBe(true);
    expect(boss.schedule).toHaveBeenCalledOnce();
    expect(boss.schedule.mock.calls[0]?.[0]).toBe('sweep');
    expect(boss.schedule.mock.calls[0]?.[2]).toEqual({ type: 'sweep' });
    const order = (mock: { mock: { invocationCallOrder: number[] } }) => mock.mock.invocationCallOrder[0] ?? 0;
    expect(order(boss.work)).toBeLessThan(order(boss.schedule));
    expect(boss.unschedule).not.toHaveBeenCalled();
  },
);

test('the schedule is logged with its cron expression, and never carries more than that', async () => {
  const { queue, logs } = start(30);
  await queue;
  expect(logs.lines().filter((line) => line['msg'] === 'jobs.sweep_schedule')).toEqual([
    expect.objectContaining({ sweep: '*/30 * * * *', level: 30 }),
  ]);
});

test.each([[0], [undefined]] as const)(
  'an interval of %s leaves the timekeeper off and removes a schedule a former run set',
  async (minutes) => {
    const { boss, queue, createBoss, logs } = start(minutes);
    await queue;
    expect(schedulerOn(createBoss)).toBe(false);
    expect(boss.schedule).not.toHaveBeenCalled();
    expect(boss.unschedule).toHaveBeenCalledExactlyOnceWith('sweep');
    expect(logs.lines().filter((line) => line['msg'] === 'jobs.sweep_schedule')).toEqual([
      expect.objectContaining({ sweep: 'off' }),
    ]);
  },
);

test('a queue without workers neither starts the timekeeper nor touches the schedule: it is the producer of the migrate step and of the tests', async () => {
  const { boss, queue, createBoss } = start(30, false);
  await queue;
  expect(schedulerOn(createBoss)).toBe(false);
  expect(boss.schedule).not.toHaveBeenCalled();
  expect(boss.unschedule).not.toHaveBeenCalled();
});

test('a schedule that pg-boss refuses stops pg-boss and fails the start with that error', async () => {
  const { boss, queue } = start(30);
  boss.schedule.mockRejectedValueOnce(new Error('permission denied for table schedule'));
  await expect(queue).rejects.toThrow('permission denied for table schedule');
  expect(boss.stop).toHaveBeenCalledOnce();
});
