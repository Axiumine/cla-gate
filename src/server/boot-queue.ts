// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import { MissingQueuesError } from './adapters/jobs/queue-check.ts';
import { QueuePolicyError } from './adapters/jobs/queue-policy.ts';
import { startJobQueue } from './adapters/jobs/runtime.ts';
import type { WorkerWiring } from './adapters/jobs/workers.ts';
import type { AppConfig } from './config/env.ts';
import type { JobQueue } from './services/ports/jobs.ts';

// Starting the job queue at boot (E07-S01), after the database is open.

/**
 * Starts the job queue of `config`, working the jobs with `workers` (E07-S03). Defaults to pg-boss on `DATABASE_URL`;
 * tests pass a fake, because pg-boss needs a real PostgreSQL.
 */
export type CreateJobQueue = (config: AppConfig, logger: Logger, workers: WorkerWiring) => Promise<JobQueue>;

const startPgBoss: CreateJobQueue = (config, logger, workers) =>
  startJobQueue({ connectionString: config.databaseUrl.reveal(), logger, workers });

/**
 * Starts the queue. A queue that cannot start is fatal: a server without one would acknowledge no webhook (`503`) and run
 * no job. The reason is logged and the answer is undefined; the log names the missing queues or the queues of the wrong policy, never a connection string.
 */
export async function startQueueOrReport(
  config: AppConfig,
  logger: Logger,
  workers: WorkerWiring,
  create: CreateJobQueue = startPgBoss,
): Promise<JobQueue | undefined> {
  try {
    return await create(config, logger, workers);
  } catch (error) {
    if (error instanceof MissingQueuesError) {
      logger.fatal({ queues: error.queues }, `${error.message}: run yarn db:migrate`);
    } else if (error instanceof QueuePolicyError) {
      logger.fatal({ mismatches: error.mismatches }, error.message);
    } else {
      logger.fatal({ err: error }, 'jobs.queue_start_failed');
    }
    return undefined;
  }
}
