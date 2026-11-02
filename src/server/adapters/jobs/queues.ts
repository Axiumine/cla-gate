// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The queues of the application (E07-S01). A queue is a row of `pgboss.queue`, created by the migration owner in the
// second step of `yarn db:migrate` and only checked at start-up by the runtime role, which owns nothing.

/** The schema pg-boss keeps its tables in, in the same database as the application's own (pg-boss's default name). */
export const PGBOSS_SCHEMA = 'pgboss';

/**
 * Every queue, one name per job type of the catalogue (`domain/jobs.ts`) plus the sweep queues (E07-S08) and the
 * dead-letter queue (E07-S05). A later epic that adds a job adds its queue here in the change that adds the job
 * (E07-S09, E16-S05, E22-S04): the migrate step creates what is missing, and the start-up check refuses a database that
 * lacks one.
 */
export const QUEUES = [
  'evaluate-pr',
  'evaluate-head-sha',
  'close-pr',
  'recheck-comment',
  'sync-installation',
  'revoke-user-sessions',
  'sweep',
  'sweep-installation',
  'job-dead-letter',
] as const;

export type QueueName = (typeof QUEUES)[number];
