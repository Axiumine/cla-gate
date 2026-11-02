// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import { RETRY_LIMIT } from '../../domain/job-retry.ts';

// The queues of the application (E07-S01). A queue is a row of `pgboss.queue`, created by the migration owner in the
// second step of `yarn db:migrate` and only checked at start-up by the runtime role, which owns nothing.

/** The schema pg-boss keeps its tables in, in the same database as the application's own (pg-boss's default name). */
export const PGBOSS_SCHEMA = 'pgboss';

/** The pg-boss queue policies this application uses. */
export type QueuePolicy = 'standard' | 'singleton' | 'exclusive';

/**
 * Every queue with its policy (E07-S02), one name per job type of the catalogue (`domain/jobs.ts`) plus the sweep queues
 * (E07-S08) and the dead-letter queue (E07-S05). A later epic that adds a job adds its queue here in the change that adds
 * the job (E07-S09, E16-S05, E22-S04): the migrate step creates what is missing, and the start-up check refuses a
 * database that lacks one.
 *
 * `evaluate-pr` is `singleton`: any number of jobs may wait, one per key runs at a time, so the evaluations of one pull
 * request never overlap and no send is dropped. pg-boss enforces it with a unique index over the active jobs of
 * (queue, key), so it holds across workers and processes. The key is `serialisationKey` (`serialisation.ts`): a job of a
 * `singleton` queue is always sent with one, and `standard` queues ignore keys. A policy cannot be changed on a queue
 * that exists: the migrate step and the start-up check refuse a queue whose policy differs from this list. Why
 * `singleton`, and why not the other policies of the pg-boss documentation, is decided by `serialisation-real.test.ts`
 * and `serialisation-interleavings.test.ts`.
 *
 * `sweep` is `exclusive` (E07-S08): at most one job in `created`, `retry` or `active` at a time, so a sweep that is still
 * running (or waiting to be retried) when the scheduler's next tick comes makes that tick send nothing, and two sweeps never
 * reconcile the installations at once. A job that ended (completed, failed, cancelled) no longer counts.
 */
export const QUEUE_DEFINITIONS = [
  { name: 'evaluate-pr', policy: 'singleton' },
  { name: 'evaluate-head-sha', policy: 'standard' },
  { name: 'close-pr', policy: 'standard' },
  { name: 'recheck-comment', policy: 'standard' },
  { name: 'sync-installation', policy: 'standard' },
  { name: 'revoke-user-sessions', policy: 'standard' },
  { name: 'sweep', policy: 'exclusive' },
  { name: 'sweep-installation', policy: 'standard' },
  { name: 'job-dead-letter', policy: 'standard' },
] as const satisfies readonly { readonly name: string; readonly policy: QueuePolicy }[];

export type QueueName = (typeof QUEUE_DEFINITIONS)[number]['name'];

/** The names of {@link QUEUE_DEFINITIONS}, in the same order. */
export const QUEUES: readonly QueueName[] = QUEUE_DEFINITIONS.map(({ name }) => name);

/**
 * pg-boss's own queue for the occurrences of a schedule (E07-S08): the scheduler files each due occurrence of `sweep` here
 * and a worker of pg-boss forwards it to the queue it names. It is not one of ours, so it is not in {@link QUEUES} and has no
 * dead-letter queue (a lost tick is made up by the next one); the migrate step creates it so the runtime role does not
 * have to (`createQueue` of a queue that is not partitioned is a plain `INSERT`, but only the owner creates queues).
 */
export const SCHEDULER_QUEUE = '__pgboss__send-it';

/** The queue that takes the jobs whose retries are spent (E07-S05), and the one every other queue names as its dead-letter queue. */
export const DEAD_LETTER_QUEUE: QueueName = 'job-dead-letter';

/**
 * How long a job may stay `active` before pg-boss takes it back (retry, or failed when no retry is left): the time a
 * worker that died mid-run keeps the key of its job blocked (E07-S02, property P4).
 */
const EXPIRE_IN_SECONDS = 300;

const DAY_SECONDS = 86_400;

/** What every queue is created with besides its policy (E07-S05), checked against pg-boss 12.38.0 (`QueueOptions`). */
export interface QueueBounds {
  /** Retries after the first run; `RETRY_LIMIT` (5), so a job that always fails runs 6 times. */
  readonly retryLimit: number;
  /** Seconds before the first retry; with backoff it is the base of the schedule, which doubles at every retry (with jitter). */
  readonly retryDelay: number;
  readonly retryBackoff: boolean;
  readonly expireInSeconds: number;
  /** Seconds a job may wait in `created` or `retry` before pg-boss deletes it (pg-boss 12 has no archive step). */
  readonly retentionSeconds: number;
  /** Seconds a finished job (completed, failed or cancelled) is kept before pg-boss deletes it. */
  readonly deleteAfterSeconds: number;
}

/**
 * The bounds of every queue (E07-S05): five retries, 30 s before the first and doubling after it, a job that stays active
 * for 300 s is taken back, a finished job is deleted after 7 days and one that never ran after 14 days. The `pgboss`
 * tables stay bounded without a purge job of our own, because pg-boss's maintenance deletes by these windows.
 */
const QUEUE_BOUNDS: QueueBounds = {
  retryLimit: RETRY_LIMIT,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: EXPIRE_IN_SECONDS,
  retentionSeconds: 14 * DAY_SECONDS,
  deleteAfterSeconds: 7 * DAY_SECONDS,
};

/** What a queue is created with: its policy, the {@link QUEUE_BOUNDS} and its dead-letter queue (the dead-letter queue itself has none). */
export interface QueueSettings extends QueueBounds {
  readonly policy: QueuePolicy;
  readonly deadLetter?: string;
}

/** The settings of a queue of {@link QUEUE_DEFINITIONS}: its policy, the bounds, and `job-dead-letter` as its dead-letter queue. */
export function queueSettings({ name, policy }: (typeof QUEUE_DEFINITIONS)[number]): QueueSettings {
  return name === DEAD_LETTER_QUEUE
    ? { policy, ...QUEUE_BOUNDS }
    : { policy, ...QUEUE_BOUNDS, deadLetter: DEAD_LETTER_QUEUE };
}

/** What {@link SCHEDULER_QUEUE} is created with: the bounds of every queue, a standard policy and no dead-letter queue. */
export function schedulerQueueSettings(): QueueSettings {
  return { policy: 'standard', ...QUEUE_BOUNDS };
}

/** The definitions in the order the queues are created: pg-boss wants a dead-letter queue to exist before a queue can name it. */
export const DEFINITIONS_IN_CREATION_ORDER: readonly (typeof QUEUE_DEFINITIONS)[number][] = [
  ...QUEUE_DEFINITIONS.filter(({ name }) => name === DEAD_LETTER_QUEUE),
  ...QUEUE_DEFINITIONS.filter(({ name }) => name !== DEAD_LETTER_QUEUE),
];
