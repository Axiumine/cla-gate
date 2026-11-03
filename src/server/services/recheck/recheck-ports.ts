// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { EvaluatePrPorts } from '../evaluate-pr/evaluate-pr-ports.ts';
import type { JobEnqueuer } from '../ports/jobs.ts';

// What the jobs of the manual re-evaluation are given (E07-S07). They read and write what the repository snapshot reads and
// writes (the database, the GitHub client bound to the signal of the job, the clock) and send `evaluate-pr` jobs; they
// run no engine and write no report.

/** What the jobs are made of. */
export type RecheckPorts = Pick<EvaluatePrPorts, 'db' | 'github' | 'clock'>;

/** What the jobs need of their run beyond the envelope. */
export interface RecheckContext {
  /** A logger that already carries the job id, type and numeric ids. */
  readonly logger: Logger;
  /** Where the evaluations are sent. */
  readonly enqueuer: JobEnqueuer;
  /** The id of the job on the queue: it stays the same across the retries of the job. */
  readonly jobId: string;
}
