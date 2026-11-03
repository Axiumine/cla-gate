// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { ClosePrPorts } from '../close-pr/close-pr-ports.ts';
import type { EvaluatePrPorts } from '../evaluate-pr/evaluate-pr-ports.ts';
import type { JobEnqueuer, PendingJobs } from '../ports/jobs.ts';

// What the jobs of the scheduled sweep are given (E07-S08). `sweep-installation` reads and writes what the `close-pr` job does
// (the database, the GitHub client bound to the signal of the job, the clock, the reporter that ends a Check Run) and sends
// jobs; it never runs the engine.

/** What `sweep-installation` is made of. */
export type SweepPorts = ClosePrPorts;

/**
 * What `sweep-repository` is made of (E07-S09): the database, the GitHub client bound to the signal of the job and the clock of
 * the repository snapshot. There is no reporter in it: the job sends jobs and never writes a Check Run or a comment.
 */
export type PolicySweepPorts = Pick<EvaluatePrPorts, 'db' | 'github' | 'clock'>;

/** What the jobs of the sweep need of their run beyond the envelope. */
export interface SweepContext {
  /** A logger that already carries the job id, type and numeric ids. */
  readonly logger: Logger;
  /** Where the jobs of the sweep are sent, on the connection of a transaction the job opens. */
  readonly enqueuer: JobEnqueuer;
  /** The queue the job runs on: the reaper drops the jobs that wait for a pull request it finds closed (E07-S06). */
  readonly pending: PendingJobs;
  /** The id of the running job, which names the sends of one run so that a retry does not send twice. */
  readonly jobId: string;
  /** Aborts when the job must stop: a failure while it is aborted is the job's, never a repository's. */
  readonly signal: AbortSignal;
}
