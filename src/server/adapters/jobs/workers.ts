// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { JobType } from '../../domain/job-envelope.ts';
import { type JobRunDeps, runJob } from '../../services/job-run.ts';
import type { StopOutcome } from '../../services/ports/jobs.ts';
import type { Boss, WorkerJob, WorkerOptions, WorkerResult } from './boss.ts';

// The workers of the job queue (E07-S03): one pg-boss worker pool per job type that has a handler, each job run through
// `runJob` (validation, logs, delivery marking) and settled with its verdict. A queue whose type has no handler gets no
// worker and keeps its jobs. `localConcurrency` is how many jobs of one queue run at once in this process; the
// serialisation of one pull request's evaluations is the queue's own policy (E07-S02), not the workers'.

/** How the workers are started. */
export interface WorkersOptions extends JobRunDeps {
  /** How many jobs of one queue run at once (`WORKER_CONCURRENCY`, 1 to 32). */
  readonly concurrency: number;
  /** Seconds between two looks at an empty queue. Defaults to pg-boss's own, 2; a test shortens it. */
  readonly pollingIntervalSeconds?: number | undefined;
}

/** What boot hands the queue to run jobs: {@link WorkersOptions} without the logger, which the queue brings. */
export type WorkerWiring = Omit<WorkersOptions, 'logger'>;

export class Workers {
  readonly #options: WorkersOptions;
  #running = 0;
  #abortedAtStop = 0;
  #stopping = false;

  constructor(options: WorkersOptions) {
    this.#options = options;
  }

  /** Starts working the queue of every type that has a handler. */
  async start(boss: Boss): Promise<void> {
    const { concurrency, pollingIntervalSeconds } = this.#options;
    const options: WorkerOptions = {
      localConcurrency: concurrency,
      batchSize: 1,
      perJobResults: true,
      ...(pollingIntervalSeconds === undefined ? {} : { pollingIntervalSeconds }),
    };
    for (const type of this.#options.registry.types()) {
      await boss.work(type, options, (jobs) => this.#handle(type, jobs));
    }
  }

  /** The shutdown begins: a job that is aborted from now on was aborted by it. */
  beginStop(): void {
    this.#stopping = true;
  }

  /**
   * How the shutdown went, once pg-boss has stopped: `aborted` when a job was still running when the grace period ended
   * (pg-boss failed it and aborted its signal; it runs again after a restart), `drained` when every job finished.
   */
  outcome(): StopOutcome {
    return this.#running > 0 || this.#abortedAtStop > 0 ? 'aborted' : 'drained';
  }

  async #handle(type: JobType, jobs: readonly WorkerJob[]): Promise<WorkerResult[]> {
    this.#running += 1;
    try {
      return await Promise.all(jobs.map(async (job) => ({ id: job.id, ...(await runJob(type, job, this.#options)) })));
    } catch (error) {
      if (this.#stopping && jobs.some((job) => job.signal.aborted)) {
        this.#abortedAtStop += 1;
      }
      throw error;
    } finally {
      this.#running -= 1;
    }
  }
}
