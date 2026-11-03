// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { JobType } from '../../domain/job-envelope.ts';
import type { SweepInterval } from '../../domain/sweep.ts';
import { type DeadLetterPorts, deadLetterRegistry } from '../../services/dead-letter/dead-letter-registry.ts';
import { runDeadLetter } from '../../services/dead-letter/dead-letter-run.ts';
import { type JobRunDeps, type JobVerdict, runJob } from '../../services/job-run.ts';
import type { StopOutcome } from '../../services/ports/jobs.ts';
import type { Boss, WorkerJob, WorkerOptions, WorkerResult } from './boss.ts';
import { PgBossEnqueuer } from './enqueuer.ts';
import { PgBossPendingJobs } from './pending.ts';
import { DEAD_LETTER_QUEUE } from './queues.ts';
import { failOnUnhandledRejection, installRejectionGuard } from './rejection-guard.ts';

// The workers of the job queue (E07-S03): one pg-boss worker pool per job type that has a handler, each job run through
// `runJob` (validation, logs, delivery marking) and settled with its verdict, and (E07-S05) one for the dead-letter queue.
// A queue whose type has no handler gets no worker and keeps its jobs. `localConcurrency` is how many jobs of one queue run at once in this process; the
// serialisation of one pull request's evaluations is the queue's own policy (E07-S02), not the workers'.

/** How the workers are started. The queue the jobs run on (`pending`, `enqueuer`) is the one the workers are started on, so it is not an option. */
export interface WorkersOptions extends Omit<JobRunDeps, 'pending' | 'enqueuer'> {
  /** How many jobs of one queue run at once (`WORKER_CONCURRENCY`, 1 to 32). */
  readonly concurrency: number;
  /** Seconds between two looks at an empty queue. Defaults to pg-boss's own, 2; a test shortens it. */
  readonly pollingIntervalSeconds?: number | undefined;
  /**
   * Minutes between two reconciliation sweeps the queue schedules (E07-S08); 0 or absent for none. The workers do not read it:
   * the queue that starts them does, because a sweep is scheduled only where its handlers can run.
   */
  readonly sweepIntervalMinutes?: SweepInterval | undefined;
  /** What the handlers of the dead-letter queue run on (E07-S05). Without it the queue is not worked and keeps the jobs the others gave up. */
  readonly deadLetter?: DeadLetterPorts | undefined;
}

/** What boot hands the queue to run jobs: {@link WorkersOptions} without the logger, which the queue brings. */
export type WorkerWiring = Omit<WorkersOptions, 'logger'>;

/** The data of a rejected job as the copy in the dead-letter queue holds it: the object as it was, or an empty one for data that is no object. */
function copyOf(data: unknown): object {
  return typeof data === 'object' && data !== null && !Array.isArray(data) ? data : {};
}

export class Workers {
  readonly #options: WorkersOptions;
  #running = 0;
  #abortedAtStop = 0;
  #stopping = false;
  #releaseGuard: (() => void) | undefined;

  constructor(options: WorkersOptions) {
    this.#options = options;
  }

  /** Starts working the queue of every type that has a handler, and the dead-letter queue when it has ports. */
  async start(boss: Boss): Promise<void> {
    const { concurrency, pollingIntervalSeconds, deadLetter } = this.#options;
    this.#releaseGuard ??= installRejectionGuard();
    const options: WorkerOptions = {
      localConcurrency: concurrency,
      batchSize: 1,
      perJobResults: true,
      ...(pollingIntervalSeconds === undefined ? {} : { pollingIntervalSeconds }),
    };
    for (const type of this.#options.registry.types()) {
      await boss.work(type, options, (jobs) => this.#settle(jobs, (job) => this.#run(boss, type, job)));
    }
    if (deadLetter !== undefined) {
      const run = {
        registry: deadLetterRegistry(deadLetter, this.#options.clock),
        logger: this.#options.logger,
        pending: new PgBossPendingJobs(boss),
        enqueuer: new PgBossEnqueuer(boss),
      };
      await boss.work(DEAD_LETTER_QUEUE, options, (jobs) =>
        this.#settle(jobs, (job) =>
          failOnUnhandledRejection(this.#options.logger, async () => ({
            status: 'completed',
            output: { outcome: (await runDeadLetter(job, run)).outcome },
          })),
        ),
      );
    }
  }

  /** Stops guarding the process against the unhandled rejections of jobs (the workers are gone, or never started). */
  release(): void {
    this.#releaseGuard?.();
    this.#releaseGuard = undefined;
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

  /**
   * Runs one job of the queue `type`. Data that is not the job's envelope is rejected without a retry (E07-S05): the job is
   * completed with `{ rejected: 'invalid_payload' }` and a copy of its data goes to the dead-letter queue under the same id,
   * so a run that sends the copy and dies before it settles the job sends nothing twice.
   */
  async #run(boss: Boss, type: JobType, job: WorkerJob): Promise<JobVerdict> {
    const verdict = await failOnUnhandledRejection(this.#options.logger, () =>
      runJob(type, job, {
        ...this.#options,
        pending: new PgBossPendingJobs(boss),
        enqueuer: new PgBossEnqueuer(boss),
      }),
    );
    if (verdict.status === 'completed') {
      return verdict;
    }
    await boss.send(DEAD_LETTER_QUEUE, copyOf(job.data), { id: job.id });
    return { status: 'completed', output: { rejected: 'invalid_payload' } };
  }

  /** Settles each job of a batch with the verdict `run` gives it, counting the batch while it runs (for the shutdown). */
  async #settle(jobs: readonly WorkerJob[], run: (job: WorkerJob) => Promise<JobVerdict>): Promise<WorkerResult[]> {
    this.#running += 1;
    try {
      return await Promise.all(jobs.map(async (job) => ({ id: job.id, ...(await run(job)) })));
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
