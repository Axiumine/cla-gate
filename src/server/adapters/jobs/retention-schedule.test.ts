// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { jobEnvelopeSchema } from '../../domain/job-envelope.ts';
import { QUEUES } from './queues.ts';
import { applyRetentionSchedule } from './retention-schedule.ts';
import { fakeBoss } from './test-support.ts';

// The daily schedule of the retention sweep (E22-S04), with a pg-boss that is only a script. Against a real server:
// retention-real.test.ts.

test('the schedule is one recurring retention-sweep job at 03:17 UTC every day, whose data is the envelope of the job', async () => {
  const boss = fakeBoss();
  expect(await applyRetentionSchedule(boss)).toBe('17 3 * * *');
  expect(boss.schedule).toHaveBeenCalledExactlyOnceWith(
    'retention-sweep',
    '17 3 * * *',
    { type: 'retention-sweep' },
    { tz: 'UTC' },
  );
  expect(boss.unschedule).not.toHaveBeenCalled();
  expect(jobEnvelopeSchema.parse(boss.schedule.mock.calls[0]?.[2])).toEqual({ type: 'retention-sweep' });
});

test('the name of the schedule is a queue of the application, which is where the scheduler sends each occurrence', async () => {
  const boss = fakeBoss();
  await applyRetentionSchedule(boss);
  expect(QUEUES).toContain(boss.schedule.mock.calls[0]?.[0]);
});

test('a schedule that pg-boss refuses is not swallowed', async () => {
  const boss = fakeBoss();
  boss.schedule.mockRejectedValueOnce(new Error('permission denied for table schedule'));
  await expect(applyRetentionSchedule(boss)).rejects.toThrow('permission denied for table schedule');
});
