// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { SweepInterval } from '../../domain/sweep.ts';
import type { Boss } from './boss.ts';

// The schedule of the reconciliation sweep (E07-S08): one recurring `sweep` job on pg-boss's scheduler, every
// `SWEEP_INTERVAL_MINUTES`. The schedule lives in the `pgboss.schedule` table, so it outlives a restart and is shared by every
// instance that runs against the database: each start puts the schedule in line with its configuration (a changed interval
// replaces the old one; 0 removes it), and pg-boss's cron claim makes one instance send each occurrence.

/** The queue, the schedule and the job type all share this name. */
const SWEEP = 'sweep';

/** The data of every occurrence: the envelope of the `sweep` job (`domain/job-envelope.ts`). */
const SWEEP_DATA = { type: SWEEP } as const;

/**
 * The cron expression (UTC) of a sweep every `minutes` minutes: the minute field repeats from :00 inside the hour, and every
 * allowed interval divides an hour, so the runs are evenly spaced. An hour is `0 * * * *`.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export function sweepCron(minutes: Exclude<SweepInterval, 0>): string {
  return minutes === 60 ? '0 * * * *' : `*/${minutes} * * * *`;
}

/**
 * Puts the schedule of the sweep in line with `minutes`: a recurring `sweep` job when it is above 0, no schedule when it is 0.
 * @returns what is now so: the cron expression, or `off`.
 */
export async function applySweepSchedule(boss: Boss, minutes: SweepInterval): Promise<string> {
  if (minutes === 0) {
    await boss.unschedule(SWEEP);
    return 'off';
  }
  const cron = sweepCron(minutes);
  await boss.schedule(SWEEP, cron, SWEEP_DATA);
  return cron;
}
