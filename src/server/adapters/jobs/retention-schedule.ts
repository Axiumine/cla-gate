// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Boss } from './boss.ts';

// The schedule of the retention sweep (E22-S04): one recurring `retention-sweep` job on pg-boss's scheduler, once a day. Like the
// schedule of the reconciliation sweep (`sweep-schedule.ts`) it lives in the `pgboss.schedule` table, so it outlives a restart
// and is shared by every instance that runs against the database: each start puts it in line with this file, and pg-boss's cron
// claim makes one instance send each occurrence. A server that is down at 03:17 skips that day (pg-boss's default for a missed
// occurrence); the next day's run takes what is due by then.

/** The queue, the schedule and the job type all share this name. */
const RETENTION_SWEEP = 'retention-sweep';

/** The data of every occurrence: the envelope of the `retention-sweep` job (`domain/job-envelope.ts`). */
const RETENTION_DATA = { type: RETENTION_SWEEP } as const;

/** Every day at 03:17 UTC, a minute that no other schedule of the daily kind uses, read in UTC whatever the zone of the host. */
const RETENTION_CRON = '17 3 * * *';
const RETENTION_ZONE = { tz: 'UTC' } as const;

/**
 * Puts the daily schedule of the retention sweep on the scheduler, replacing the one a former run set.
 * @returns the cron expression, for the log line of the start.
 */
export async function applyRetentionSchedule(boss: Boss): Promise<string> {
  await boss.schedule(RETENTION_SWEEP, RETENTION_CRON, RETENTION_DATA, RETENTION_ZONE);
  return RETENTION_CRON;
}
