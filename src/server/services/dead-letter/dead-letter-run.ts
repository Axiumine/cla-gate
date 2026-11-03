// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import { z } from 'zod';
import { JOB_TYPES, jobEnvelopeSchema, logFieldsOf } from '../../domain/job-envelope.ts';
import { RETRY_LIMIT } from '../../domain/job-retry.ts';
import type { HandlerRegistry, JobOutcome } from '../job-registry.ts';
import { issuesOf, type QueuedJob } from '../job-run.ts';
import type { JobEnqueuer, PendingJobs } from '../ports/jobs.ts';

// The wrapper around the dead-letter handlers (E07-S05), the counterpart of `runJob` for the `job-dead-letter` queue: it
// reads the `type` every envelope carries, which is how one handler tells what died, logs the job at error, and runs the
// row of the dead-letter table for its type. It never marks a delivery processed: the job did not complete, so GitHub's
// redelivery must requeue it (E06-S06). There is no loop: the dead-letter queue has no dead-letter queue, a dead-letter job
// is retried under the same bounds as every job, and the last failure is logged as `dead_letter_unhandled`.

export interface DeadLetterRun {
  readonly registry: HandlerRegistry;
  readonly logger: Logger;
  /** The queue the job runs on (E07-S06): no dead-letter handler uses it, it is part of what every handler is given. */
  readonly pending: PendingJobs;
  /** Likewise (E07-S07): no dead-letter handler sends a job. */
  readonly enqueuer: JobEnqueuer;
}

/** The `type` a payload names, when it is one of the closed set: what is safe to log of data that did not pass the envelope. */
function namedType(data: unknown): string | undefined {
  const named = z.looseObject({ type: z.string() }).safeParse(data);
  return JOB_TYPES.find((type) => named.success && type === named.data.type);
}

/**
 * Runs one dead job.
 * - Data that is not an envelope (a payload the workers rejected, E07-S03) cannot be acted on: it is logged at error with
 *   the fields that failed and why, never their values, and the job completes as `unrecognised`.
 * - Otherwise the row for its type runs, and the job is logged at error with the outcome (`job.dead_lettered`).
 * - A handler that throws is logged and rethrown: the queue retries the dead-letter job, and when its last attempt fails
 *   (`retryCount` is the retry limit) the failure is logged as `dead_letter_unhandled`.
 * @throws what the handler throws, or the reason of the signal for a job that was aborted.
 */
export async function runDeadLetter(job: QueuedJob, run: DeadLetterRun): Promise<JobOutcome> {
  const base = { jobId: job.id, attempt: job.retryCount };
  const parsed = jobEnvelopeSchema.safeParse(job.data);
  if (!parsed.success) {
    run.logger.error(
      { ...base, type: namedType(job.data), issues: issuesOf(parsed.error), outcome: 'unrecognised' },
      'job.dead_lettered',
    );
    return { outcome: 'unrecognised' };
  }
  const envelope = parsed.data;
  const logger = run.logger.child({ ...base, type: envelope.type, ...logFieldsOf(envelope) });
  try {
    const result = await run.registry.run(envelope.type, envelope, {
      jobId: job.id,
      attempt: job.retryCount,
      signal: job.signal,
      logger,
      pending: run.pending,
      enqueuer: run.enqueuer,
    });
    job.signal.throwIfAborted();
    logger.error({ outcome: result.outcome }, 'job.dead_lettered');
    return result;
  } catch (error) {
    logger.warn({ err: error }, 'dead_letter.failed');
    if (job.retryCount >= RETRY_LIMIT) {
      logger.error({ err: error }, 'dead_letter_unhandled');
    }
    throw error;
  }
}
