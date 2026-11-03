// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ConstructorOptions } from 'pg-boss';
import type { Logger } from 'pino';
import type { JobQueue, StopOutcome } from '../../services/ports/jobs.ts';
import { type Boss, createPgBoss, runtimeBossOptions } from './boss.ts';
import { PgBossEnqueuer } from './enqueuer.ts';
import { assertQueues, missingQueues } from './queue-check.ts';
import { applySweepSchedule } from './sweep-schedule.ts';
import { Workers, type WorkerWiring } from './workers.ts';

// The job queue at run time (E07-S01): pg-boss started as the runtime role, which neither creates nor migrates the
// schema, with the check that every queue of `QUEUES` exists; and, with workers (E07-S03), the handlers of the jobs
// running on it and a shutdown that lets them finish.

/**
 * How long a shutdown waits for the running jobs before it aborts them (E07-S03).
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const STOP_GRACE_MS = 30_000;

export interface StartJobQueueOptions {
  /** Contains the password: pass it from a `Secret`, never log it. */
  readonly connectionString: string;
  readonly logger: Logger;
  /** Defaults to pg-boss. Tests pass a fake. */
  readonly createBoss?: (options: ConstructorOptions) => Boss;
  /** The handlers and what runs them. Without it the queue only sends: nothing is worked (the migrate step and the tests of the producer). */
  readonly workers?: WorkerWiring;
  /** Milliseconds the shutdown waits for running jobs before it aborts them. Defaults to {@link STOP_GRACE_MS}; a test shortens it (pg-boss reads at least 1000). */
  readonly graceMs?: number;
}

/** True when every queue exists. False when one is missing or the queues cannot be read; says nothing about why not. */
async function queuesAnswer(boss: Boss): Promise<boolean> {
  try {
    return (await missingQueues(boss)).length === 0;
  } catch {
    return false;
  }
}

/**
 * Starts pg-boss, checks the queues, starts the workers and puts the schedule of the sweep in line with the configuration
 * (E07-S08: pg-boss's timekeeper runs only when a sweep is scheduled). A `error` event of pg-boss is logged (`jobs.queue_error`) and
 * makes the queue not ready until a read of the queues succeeds again; a stopped queue is never ready, and neither is one
 * that lacks a queue of the application (E07-S03).
 * @throws MissingQueuesError naming the queues the database lacks, QueuePolicyError naming those of the wrong policy
 * (E07-S02); anything pg-boss throws on start (the schema is not installed or out of date, the database is unreachable).
 * pg-boss is stopped before any of them is thrown.
 */
export async function startJobQueue(options: StartJobQueueOptions): Promise<JobQueue> {
  const { logger } = options;
  const sweepMinutes = options.workers?.sweepIntervalMinutes ?? 0;
  const boss = (options.createBoss ?? createPgBoss)(runtimeBossOptions(options.connectionString, sweepMinutes !== 0));
  const workers = options.workers === undefined ? undefined : new Workers({ ...options.workers, logger });
  let errors = 0;
  let recovered = 0;
  let stopping: Promise<StopOutcome> | undefined;
  boss.on('error', (error) => {
    errors += 1;
    logger.error({ err: error }, 'jobs.queue_error');
  });
  try {
    await boss.start();
    await assertQueues(boss);
    await workers?.start(boss);
    if (workers !== undefined) {
      logger.info({ sweep: await applySweepSchedule(boss, sweepMinutes) }, 'jobs.sweep_schedule');
    }
  } catch (error) {
    workers?.release();
    await boss.stop().catch(() => undefined);
    throw error;
  }
  const stop = async (): Promise<StopOutcome> => {
    workers?.beginStop();
    await boss.stop({ graceful: true, timeout: options.graceMs ?? STOP_GRACE_MS });
    workers?.release();
    return workers?.outcome() ?? 'drained';
  };
  return {
    enqueuer: new PgBossEnqueuer(boss),
    async isReady() {
      if (stopping !== undefined) {
        return false;
      }
      const seen = errors;
      const answers = await queuesAnswer(boss);
      if (answers) {
        recovered = Math.max(recovered, seen);
      }
      return answers && errors === recovered;
    },
    stop: () => (stopping ??= stop()),
  };
}
