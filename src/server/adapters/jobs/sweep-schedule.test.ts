// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { jobEnvelopeSchema } from '../../domain/job-envelope.ts';
import { SWEEP_INTERVALS } from '../../domain/sweep.ts';
import { applySweepSchedule, sweepCron } from './sweep-schedule.ts';
import { fakeBoss } from './test-support.ts';

// The cron expression and the schedule of the reconciliation sweep (E07-S08), with a pg-boss that is only a script. Against a
// real server: sweep-schedule-real.test.ts.

const RUNNING = SWEEP_INTERVALS.filter((minutes) => minutes !== 0);

test.each([
  [5, '*/5 * * * *'],
  [10, '*/10 * * * *'],
  [15, '*/15 * * * *'],
  [20, '*/20 * * * *'],
  [30, '*/30 * * * *'],
  [60, '0 * * * *'],
] as const)('a sweep every %s minutes is the cron expression %s', (minutes, cron) => {
  expect(sweepCron(minutes)).toBe(cron);
});

test.each(RUNNING)(
  'a schedule of %s minutes puts one recurring sweep job on the scheduler, whose data is the envelope of a sweep',
  async (minutes) => {
    const boss = fakeBoss();
    expect(await applySweepSchedule(boss, minutes)).toBe(sweepCron(minutes));
    expect(boss.schedule).toHaveBeenCalledExactlyOnceWith('sweep', sweepCron(minutes), { type: 'sweep' });
    expect(boss.unschedule).not.toHaveBeenCalled();
    expect(jobEnvelopeSchema.parse(boss.schedule.mock.calls[0]?.[2])).toEqual({ type: 'sweep' });
  },
);

test('an interval of 0 removes the schedule and sets none: that is how a sweep is turned off, also for one a former run scheduled', async () => {
  const boss = fakeBoss();
  expect(await applySweepSchedule(boss, 0)).toBe('off');
  expect(boss.unschedule).toHaveBeenCalledExactlyOnceWith('sweep');
  expect(boss.schedule).not.toHaveBeenCalled();
});

test('a schedule that pg-boss refuses is not swallowed', async () => {
  const boss = fakeBoss();
  boss.schedule.mockRejectedValueOnce(new Error('permission denied for table schedule'));
  await expect(applySweepSchedule(boss, 30)).rejects.toThrow('permission denied for table schedule');
});
