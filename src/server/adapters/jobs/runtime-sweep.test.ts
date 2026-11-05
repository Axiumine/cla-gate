// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ConstructorOptions } from 'pg-boss';
import { expect, test, vi } from 'vitest';
import { jobEnvelopeSchema } from '../../domain/job-envelope.ts';
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

/** The calls to `boss.schedule` for the schedule `name`, the data of each included. */
const scheduled = (boss: ReturnType<typeof fakeBoss>, name: string) =>
  boss.schedule.mock.calls.filter(([scheduleName]) => scheduleName === name);

test.each([5, 10, 15, 20, 30, 60] as const)(
  'an interval of %s minutes starts the timekeeper and schedules the sweep once the workers work',
  async (minutes) => {
    const { boss, queue, createBoss } = start(minutes);
    await queue;
    expect(schedulerOn(createBoss)).toBe(true);
    expect(scheduled(boss, 'sweep')).toHaveLength(1);
    expect(scheduled(boss, 'sweep')[0]?.[2]).toEqual({ type: 'sweep' });
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
  'an interval of %s leaves the sweep unscheduled and removes a schedule a former run set; the timekeeper stays on for the retention sweep (E22-S04)',
  async (minutes) => {
    const { boss, queue, createBoss, logs } = start(minutes);
    await queue;
    expect(schedulerOn(createBoss)).toBe(true);
    expect(scheduled(boss, 'sweep')).toEqual([]);
    expect(boss.unschedule).toHaveBeenCalledExactlyOnceWith('sweep');
    expect(logs.lines().filter((line) => line['msg'] === 'jobs.sweep_schedule')).toEqual([
      expect.objectContaining({ sweep: 'off' }),
    ]);
  },
);

test.each([[0], [30]] as const)(
  'with the sweep at %s minutes the retention sweep is scheduled daily at 03:17 UTC, after the workers work, and the schedule is logged (E22-S04)',
  async (minutes) => {
    const { boss, queue, logs } = start(minutes);
    await queue;
    expect(scheduled(boss, 'retention-sweep')).toEqual([
      ['retention-sweep', '17 3 * * *', { type: 'retention-sweep' }, { tz: 'UTC' }],
    ]);
    const retention = scheduled(boss, 'retention-sweep')[0];
    expect(jobEnvelopeSchema.parse(retention?.[2])).toEqual({ type: 'retention-sweep' });
    const order = (mock: { mock: { invocationCallOrder: number[] } }) => mock.mock.invocationCallOrder[0] ?? 0;
    expect(order(boss.work)).toBeLessThan(order(boss.schedule));
    expect(logs.lines().filter((line) => line['msg'] === 'jobs.retention_schedule')).toEqual([
      expect.objectContaining({ retention: '17 3 * * *', level: 30 }),
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

test('a retention schedule that pg-boss refuses stops pg-boss and fails the start with that error (E22-S04)', async () => {
  const { boss, queue } = start(30);
  boss.schedule.mockImplementation((name) =>
    name === 'retention-sweep' ? Promise.reject(new Error('permission denied for table schedule')) : Promise.resolve(),
  );
  await expect(queue).rejects.toThrow('permission denied for table schedule');
  expect(boss.stop).toHaveBeenCalledOnce();
});

test('a schedule that pg-boss refuses stops pg-boss and fails the start with that error', async () => {
  const { boss, queue } = start(30);
  boss.schedule.mockRejectedValueOnce(new Error('permission denied for table schedule'));
  await expect(queue).rejects.toThrow('permission denied for table schedule');
  expect(boss.stop).toHaveBeenCalledOnce();
});
