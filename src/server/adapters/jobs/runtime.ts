// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ConstructorOptions } from 'pg-boss';
import type { Logger } from 'pino';
import type { JobQueue } from '../../services/ports/jobs.ts';
import { type Boss, createPgBoss, runtimeBossOptions } from './boss.ts';
import { PgBossEnqueuer } from './enqueuer.ts';
import { MissingQueuesError, missingQueues } from './queue-check.ts';

// The job queue at run time (E07-S01): pg-boss started as the runtime role, which neither creates nor migrates the
// schema, with the check that every queue of `QUEUES` exists.

export interface StartJobQueueOptions {
  /** Contains the password: pass it from a `Secret`, never log it. */
  readonly connectionString: string;
  readonly logger: Logger;
  /** Defaults to pg-boss. Tests pass a fake. */
  readonly createBoss?: (options: ConstructorOptions) => Boss;
}

/** True when the queues can be read. Says nothing about why not. */
async function queuesAnswer(boss: Boss): Promise<boolean> {
  try {
    return (await missingQueues(boss)).length === 0;
  } catch {
    return false;
  }
}

/**
 * Starts pg-boss and checks the queues. A `error` event of pg-boss is logged (`jobs.queue_error`) and makes the queue not
 * ready until a read of the queues succeeds again; a stopped queue is never ready.
 * @throws MissingQueuesError naming the queues the database lacks; anything pg-boss throws on start (the schema is not
 * installed or out of date, the database is unreachable). pg-boss is stopped before either is thrown.
 */
export async function startJobQueue(options: StartJobQueueOptions): Promise<JobQueue> {
  const { logger } = options;
  const boss = (options.createBoss ?? createPgBoss)(runtimeBossOptions(options.connectionString));
  let errors = 0;
  let recovered = 0;
  let stopping: Promise<void> | undefined;
  boss.on('error', (error) => {
    errors += 1;
    logger.error({ err: error }, 'jobs.queue_error');
  });
  try {
    await boss.start();
    const missing = await missingQueues(boss);
    if (missing.length > 0) {
      throw new MissingQueuesError(missing);
    }
  } catch (error) {
    await boss.stop().catch(() => undefined);
    throw error;
  }
  return {
    enqueuer: new PgBossEnqueuer(boss),
    async isReady() {
      if (stopping !== undefined) {
        return false;
      }
      const seen = errors;
      if (seen !== recovered && (await queuesAnswer(boss))) {
        recovered = Math.max(recovered, seen);
      }
      return errors === recovered;
    },
    stop: () => (stopping ??= boss.stop()),
  };
}
