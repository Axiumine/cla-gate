// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The queues of the application (E07-S01). A queue is a row of `pgboss.queue`, created by the migration owner in the
// second step of `yarn db:migrate` and only checked at start-up by the runtime role, which owns nothing.

/** The schema pg-boss keeps its tables in, in the same database as the application's own (pg-boss's default name). */
export const PGBOSS_SCHEMA = 'pgboss';

/** The pg-boss queue policies this application uses. */
export type QueuePolicy = 'standard' | 'singleton';

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
 */
export const QUEUE_DEFINITIONS = [
  { name: 'evaluate-pr', policy: 'singleton' },
  { name: 'evaluate-head-sha', policy: 'standard' },
  { name: 'close-pr', policy: 'standard' },
  { name: 'recheck-comment', policy: 'standard' },
  { name: 'sync-installation', policy: 'standard' },
  { name: 'revoke-user-sessions', policy: 'standard' },
  { name: 'sweep', policy: 'standard' },
  { name: 'sweep-installation', policy: 'standard' },
  { name: 'job-dead-letter', policy: 'standard' },
] as const satisfies readonly { readonly name: string; readonly policy: QueuePolicy }[];

export type QueueName = (typeof QUEUE_DEFINITIONS)[number]['name'];

/** The names of {@link QUEUE_DEFINITIONS}, in the same order. */
export const QUEUES: readonly QueueName[] = QUEUE_DEFINITIONS.map(({ name }) => name);

/**
 * How long a job may stay `active` before pg-boss takes it back (retry, or failed when no retry is left): the time a
 * worker that died mid-run keeps the key of its job blocked (E07-S02, property P4). Every queue has it; E07-S05 adds the
 * retry bounds to the same options.
 */
export const EXPIRE_IN_SECONDS = 300;
