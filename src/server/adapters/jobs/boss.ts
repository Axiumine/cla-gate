// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import {
  type ConstructorOptions,
  type Db,
  type Job,
  type JobResult,
  PgBoss,
  type SendOptions,
  type StopOptions,
} from 'pg-boss';
import type { QueueUpdate } from './queue-options.ts';
import type { ExistingQueue } from './queue-policy.ts';
import { PGBOSS_SCHEMA, type QueueSettings } from './queues.ts';

// The part of pg-boss this application uses, and the two ways it is started (E07-S01). The queue code depends on
// {@link Boss}, not on the class, so a test hands it a fake and the 100% gate holds on PGlite (pg-boss itself needs a
// real PostgreSQL: the behaviour tests run in the advisory `postgres` job).

/** What a worker settles one job with: pg-boss's `JobResult`, whose `output` is an object (pg-boss types it `any`). */
export type WorkerResult = JobResult<object>;

/**
 * A job as the handler of a worker receives it: what the wrapper of E07-S03 reads of pg-boss's own `Job`. The data is
 * `unknown`: pg-boss types it as an object, but the column is nullable JSON, and the wrapper does not trust it (E07-S05).
 */
export interface WorkerJob extends Pick<Job, 'id' | 'retryCount' | 'signal'> {
  readonly data: unknown;
}

/**
 * How a queue is worked (E07-S03): `localConcurrency` jobs of the queue at once in this process, one job per fetch, and
 * the handler settles every job itself with its own output, so a job whose data is invalid is completed as rejected
 * (E07-S05) instead of being retried.
 */
export interface WorkerOptions {
  readonly localConcurrency: number;
  readonly batchSize: 1;
  readonly perJobResults: true;
  /** Seconds between two looks at an empty queue (pg-boss reads at least 0.5). Defaults to pg-boss's own, 2. */
  readonly pollingIntervalSeconds?: number;
}

/** pg-boss as the application uses it; `PgBoss` satisfies it. */
export interface Boss {
  start(): Promise<unknown>;
  /**
   * Stops the workers and closes pg-boss's own pool. With `graceful` (the default) the jobs that run are given `timeout`
   * ms to finish; after that they are failed, their signals abort and they are retried by whoever works the queue next.
   */
  stop(options?: StopOptions): Promise<void>;
  /** Starts working `name`: `handler` gets the jobs fetched and answers how each one is settled. */
  work(name: string, options: WorkerOptions, handler: (jobs: WorkerJob[]) => Promise<WorkerResult[]>): Promise<string>;
  on(event: 'error', listener: (error: Error) => void): unknown;
  /**
   * Creates the queue with the policy, the bounds and the dead-letter queue of `options` (E07-S02, E07-S05); a policy cannot
   * be changed afterwards, and a dead-letter queue must exist before a queue names it.
   */
  createQueue(name: string, options: QueueSettings): Promise<void>;
  /** Changes the bounds and the dead-letter queue of a queue that exists (E07-S05). The policy is not among them: it cannot change. */
  updateQueue(name: string, options: QueueUpdate): Promise<void>;
  /** The queues of these names that exist, with the policy (`standard` when pg-boss gives none), the bounds and the dead-letter queue each has. */
  getQueues(names: string[]): Promise<readonly ExistingQueue[]>;
  /** The background index builds a pg-boss migration queued, counted by status. */
  getBamStatus(): Promise<readonly { readonly status: string; readonly count: number }[]>;
  /** The id of the job, or `null` when nothing was inserted (the id exists, or a throttle window or a queue policy refused it). */
  send(name: string, data: object, options: SendOptions): Promise<string | null>;
  /**
   * The jobs of the queue that match every option given: the `id`, or the `data` the job's payload contains (a JSON
   * containment, so `{ prNumber: 7 }` matches a payload with more fields), and with `queued` only the jobs that wait, which
   * are `created` and `retry` and not `active` (E07-S06), and with `key` only the jobs of that `singletonKey` (E07-S01). Oldest
   * first, `limit` at most (1,000 by default).
   */
  findJobs(
    name: string,
    options: {
      readonly id?: string;
      readonly key?: string;
      readonly data?: object;
      readonly queued?: boolean;
      readonly limit?: number;
      readonly db?: Db;
    },
  ): Promise<readonly { readonly id: string; readonly state: string }[]>;
  deleteJob(name: string, id: string, options: { readonly db: Db }): Promise<unknown>;
  /**
   * Cancels the jobs of the queue under these ids, which have not finished: pg-boss moves any job below `completed` to
   * `cancelled`, a running one included, so the caller selects what it cancels (E07-S06).
   */
  cancel(name: string, ids: string[]): Promise<unknown>;
  /**
   * Puts the recurring job `name` on the cron expression `cron` (UTC), to be sent with `data` at every occurrence (E07-S08). A
   * second call for the same name replaces the schedule, so calling it at every start is safe. The occurrences are sent by
   * the timekeeper of a pg-boss that was started with `schedule: true`.
   */
  schedule(name: string, cron: string, data: object): Promise<void>;
  /** Removes the schedule of `name` (E07-S08); there is no error when it has none. */
  unschedule(name: string): Promise<void>;
}

/** The size of pg-boss's own connection pool: it is separate from the application's, so the workers never starve a request. */
const BOSS_POOL_SIZE = 10;

/**
 * How the application runs pg-boss, as the runtime role `cla_app` which owns nothing: the schema is neither created nor
 * migrated (the check at start fails when it is missing or out of date) and the index rebuild is off (`REINDEX` needs the
 * table owner). The maintenance that expires stuck jobs and deletes old ones is plain DML and stays on. The cron
 * timekeeper is on only when `scheduler` says so, which is when a sweep is scheduled (E07-S08): it reads and writes the
 * `schedule` table and the queue of scheduled occurrences, which are rows, and creates nothing (the migrate step created the queue).
 */
export function runtimeBossOptions(connectionString: string, scheduler = false): ConstructorOptions {
  return {
    connectionString,
    schema: PGBOSS_SCHEMA,
    max: BOSS_POOL_SIZE,
    migrate: false,
    createSchema: false,
    schedule: scheduler,
    reindex: false,
  };
}

/**
 * How the migration owner runs pg-boss in `yarn db:migrate`: it installs or migrates the schema and creates the queues,
 * and nothing else (no maintenance, no timekeeper, no row in the instance registry). Its background worker for the index
 * builds a migration queues (`bam`) polls every 10 s, the shortest interval pg-boss accepts.
 */
export function ownerBossOptions(connectionString: string): ConstructorOptions {
  return {
    connectionString,
    schema: PGBOSS_SCHEMA,
    max: 2,
    bamIntervalSeconds: 10,
    migrate: true,
    createSchema: true,
    supervise: false,
    schedule: false,
    registerInstance: false,
  };
}

/** Builds pg-boss without starting it: no connection is made until `start()`. */
export function createPgBoss(options: ConstructorOptions): Boss {
  return new PgBoss(options);
}
