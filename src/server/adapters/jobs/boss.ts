// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type ConstructorOptions, type Db, PgBoss, type SendOptions, type StopOptions } from 'pg-boss';
import { PGBOSS_SCHEMA, type QueuePolicy } from './queues.ts';

// The part of pg-boss this application uses, and the two ways it is started (E07-S01). The queue code depends on
// {@link Boss}, not on the class, so a test hands it a fake and the 100% gate holds on PGlite (pg-boss itself needs a
// real PostgreSQL: the behaviour tests run in the advisory `postgres` job).

/** pg-boss as the application uses it; `PgBoss` satisfies it. */
export interface Boss {
  start(): Promise<unknown>;
  /** Stops the workers (waiting for the running jobs, up to the default of 30 s) and closes pg-boss's own pool. */
  stop(options?: StopOptions): Promise<void>;
  on(event: 'error', listener: (error: Error) => void): unknown;
  /** Creates the queue with the policy and the expiry of `options` (E07-S02); a policy cannot be changed afterwards. */
  createQueue(name: string, options: { readonly policy: QueuePolicy; readonly expireInSeconds: number }): Promise<void>;
  /** The queues of these names that exist, with the policy each was created with (`standard` when pg-boss gives none). */
  getQueues(names: string[]): Promise<readonly { readonly name: string; readonly policy?: string }[]>;
  /** The background index builds a pg-boss migration queued, counted by status. */
  getBamStatus(): Promise<readonly { readonly status: string; readonly count: number }[]>;
  /** The id of the job, or `null` when nothing was inserted (the id exists, or a throttle window or a queue policy refused it). */
  send(name: string, data: object, options: SendOptions): Promise<string | null>;
  findJobs(
    name: string,
    options: { readonly id: string; readonly db: Db },
  ): Promise<readonly { readonly state: string }[]>;
  deleteJob(name: string, id: string, options: { readonly db: Db }): Promise<unknown>;
}

/** The size of pg-boss's own connection pool: it is separate from the application's, so the workers never starve a request. */
const BOSS_POOL_SIZE = 10;

/**
 * How the application runs pg-boss, as the runtime role `cla_app` which owns nothing: the schema is neither created nor
 * migrated (the check at start fails when it is missing or out of date), the cron timekeeper is off (it would create a
 * queue of its own, E07-S08) and so is the index rebuild (`REINDEX` needs the table owner). The maintenance that expires
 * stuck jobs and deletes old ones is plain DML and stays on.
 */
export function runtimeBossOptions(connectionString: string): ConstructorOptions {
  return {
    connectionString,
    schema: PGBOSS_SCHEMA,
    max: BOSS_POOL_SIZE,
    migrate: false,
    createSchema: false,
    schedule: false,
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
