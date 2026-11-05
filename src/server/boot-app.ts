// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { Database } from './adapters/db/schema.ts';
import type { GitHubApp } from './adapters/github/start.ts';
import { buildApp } from './app.ts';
import { evaluationWiring } from './boot-evaluation.ts';
import type { InstallationWiring } from './boot-installations.ts';
import { jobWorkers } from './boot-jobs.ts';
import { type CreateJobQueue, startQueueOrReport } from './boot-queue.ts';
import type { AppConfig } from './config/env.ts';
import type { Clock } from './services/ports/clock.ts';
import { failExitOnAbortedStop, type ProcessLike } from './shutdown.ts';

// The application of a started server: the job queue is started after the database, with the workers that run its jobs
// (E07-S01, E07-S03; the evaluation jobs get the GitHub client and the Check Run reporter, E09-S06), and the application is built
// on both, with the GitHub client of the roles (E11-S05), the verified App identity that `GET /api/meta` reads at each request
// (E17-S09) and the operator policy (E11-S08). Split from `boot.ts` so that function stays inside the line cap.

export interface BootAppOptions {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly db: Kysely<Database>;
  readonly github: GitHubApp | undefined;
  /** What `startGitHubAndDatabase` wired besides the database and the App. */
  readonly wiring: Pick<InstallationWiring, 'syncFor' | 'operators'>;
  readonly signals: ProcessLike;
  readonly clock: Clock | undefined;
  readonly fetch: typeof fetch | undefined;
  readonly createJobQueue: CreateJobQueue | undefined;
}

/**
 * Starts the job queue and builds the application on it. A queue that cannot start is fatal: the reason is logged by
 * `startQueueOrReport`, the database is closed, the exit code is 1 and the answer is undefined, so nothing is left running.
 */
export async function buildBootApp(options: BootAppOptions): Promise<FastifyInstance | undefined> {
  const { config, logger, db, github, wiring, signals } = options;
  const evaluation = evaluationWiring({ config, logger, db, github: github?.client, clock: options.clock });
  const workers = jobWorkers({ db, config, logger, syncFor: wiring.syncFor, clock: options.clock, evaluation });
  const queue = await startQueueOrReport(config, logger, workers, options.createJobQueue);
  if (queue === undefined) {
    await db.destroy();
    signals.exitCode = 1;
    return undefined;
  }
  return buildApp({
    config,
    db,
    logger,
    clock: options.clock,
    fetch: options.fetch,
    github: github?.client,
    allowlistGitHub: github?.client,
    commitGitHub: github?.client,
    appIdentity: github?.identity,
    operators: wiring.operators,
    jobQueue: failExitOnAbortedStop(queue, logger, signals),
  });
}
