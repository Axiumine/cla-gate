// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import { type JobEnvelope, type JobType, jobEnvelopeSchema, logFieldsOf } from '../domain/job-envelope.ts';
import type { HandlerRegistry } from './job-registry.ts';
import type { Clock } from './ports/clock.ts';
import type { JobEnqueuer, PendingJobs } from './ports/jobs.ts';

// What runs around every handler (E07-S03): the validation of the job's data, the log lines with the job id, type and
// ids, the delivery that a finished job marks processed, and the verdict the queue settles the job with. It knows
// nothing of pg-boss: the adapter hands it a job and turns the verdict into the queue's own words.

/** The job as the queue hands it over: everything the wrapper reads of it. `data` is unchecked until the envelope parses it. */
export interface QueuedJob {
  readonly id: string;
  readonly data: unknown;
  /** How often the job was retried before this run. */
  readonly retryCount: number;
  readonly signal: AbortSignal;
}

/**
 * How the queue settles a job whose handler did not throw: `completed` with the handler's outcome, or `deadletter`, for
 * data that is not the job's envelope: it would fail the same way every time, so it is never retried. The queue adapter
 * turns that verdict into a rejection (E07-S05): the job is completed with `{ rejected: 'invalid_payload' }` and a copy of
 * its data goes to the dead-letter queue. A handler that throws is not a verdict: its job fails and is retried.
 */
export interface JobVerdict {
  readonly status: 'completed' | 'deadletter';
  readonly output: Readonly<Record<string, unknown>>;
}

export interface JobRunDeps {
  readonly registry: HandlerRegistry;
  /** Sets `processed_at` of a delivery (E06-S06). Only a job that completed calls it. */
  readonly markDeliveryProcessed: (deliveryId: string) => Promise<void>;
  readonly clock: Clock;
  readonly logger: Logger;
  /** The queue the job runs on, as the handlers may use it (E07-S06). */
  readonly pending: PendingJobs;
  /** Where the handlers send the jobs they start (E07-S07). */
  readonly enqueuer: JobEnqueuer;
}

/**
 * The code a job fails permanently with when its data is not the envelope of its queue.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const JOB_PAYLOAD_INVALID = 'job_payload_invalid';

/**
 * What a zod error says, as `field:code` for each issue (`githubRepoId:invalid_type`, `(object):unrecognized_keys`): the
 * names of the fields of the schema and zod's own codes, never a value and never the name of a key somebody added.
 */
export function issuesOf(error: {
  readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly code: string }[];
}): string[] {
  return error.issues.map(
    (issue) => `${issue.path.length === 0 ? '(object)' : issue.path.map(String).join('.')}:${issue.code}`,
  );
}

/** The delivery a job came from, when it came from one. */
function deliveryOf(job: JobEnvelope): string | undefined {
  return 'deliveryId' in job ? job.deliveryId : undefined;
}

/**
 * The data of a job on the queue `type`, validated: the envelope of its type, and the type of the queue it was taken from.
 * @returns the envelope, or what failed: the issues of the schema, or `type:wrong_queue` for a valid job on another queue.
 */
function parseEnvelope(type: JobType, data: unknown): { envelope: JobEnvelope } | { issues: string[] } {
  const parsed = jobEnvelopeSchema.safeParse(data);
  if (!parsed.success) {
    return { issues: issuesOf(parsed.error) };
  }
  return parsed.data.type === type ? { envelope: parsed.data } : { issues: ['type:wrong_queue'] };
}

/**
 * Runs one job of the queue `type`.
 * - Data that is not the envelope of the queue's job type ends in a `deadletter` verdict with `job_payload_invalid` and
 *   the fields that failed and why, never their values: no handler runs and no delivery is marked.
 * - Otherwise the handler runs, with start, finish and duration logged under the job id, the type and the numeric ids,
 *   never the data of the job or a token. When it completes and the job carries a `deliveryId`, that delivery is marked
 *   processed (E06-S06). A dead-lettered job does not, so GitHub's redelivery requeues it.
 * - A handler that throws is logged and rethrown, whatever the error is: the queue fails the job and retries it with
 *   backoff. That includes `GitHubRateLimitedError`, which is deliberately not caught here.
 * - A job whose signal aborted (the shutdown deadline, the expiry) was failed by the queue already: it is not completed
 *   and its delivery is not marked, even when the handler ignored the signal and finished.
 * @throws whatever the handler throws, the reason of the signal for a job that was aborted, or what marking the delivery throws.
 */
export async function runJob(type: JobType, job: QueuedJob, deps: JobRunDeps): Promise<JobVerdict> {
  const { registry, markDeliveryProcessed, clock } = deps;
  const base = { jobId: job.id, type, attempt: job.retryCount };
  const parsed = parseEnvelope(type, job.data);
  if ('issues' in parsed) {
    deps.logger.warn({ ...base, issues: parsed.issues }, 'job.payload_invalid');
    return { status: 'deadletter', output: { code: JOB_PAYLOAD_INVALID, issues: parsed.issues } };
  }
  const { envelope } = parsed;
  const logger = deps.logger.child({ ...base, ...logFieldsOf(envelope) });
  const startedAt = clock.now().getTime();
  logger.info('job.started');
  try {
    const result = await registry.run(envelope.type, envelope, {
      jobId: job.id,
      attempt: job.retryCount,
      signal: job.signal,
      logger,
      pending: deps.pending,
      enqueuer: deps.enqueuer,
    });
    job.signal.throwIfAborted();
    const deliveryId = deliveryOf(envelope);
    if (deliveryId !== undefined) {
      await markDeliveryProcessed(deliveryId);
    }
    logger.info({ outcome: result.outcome, durationMs: clock.now().getTime() - startedAt }, 'job.finished');
    return { status: 'completed', output: { outcome: result.outcome } };
  } catch (error) {
    logger.warn({ err: error, durationMs: clock.now().getTime() - startedAt }, 'job.failed');
    throw error;
  }
}
