// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';
import type { Job } from '../../domain/jobs.ts';

// Where the webhook intake hands a job (E06-S06). The queue itself (pg-boss) is E07: the port is what the intake needs
// of it, and the adapter that implements it is E07-S01.

/**
 * What `enqueue` did. `queued`: the job is on the queue. `already_queued`: nothing was sent because a job sent under the
 * same idempotency key is still alive, so that job will finish what this send was for. `deduplicated`: nothing was sent
 * because a `dedupeKey` was used in the same window, so no job will ever run for this send. An implementation
 * answers `already_queued` before `deduplicated` when both apply. The two must not be confused: the first leaves a
 * delivery to its live job, the second leaves it to nobody.
 */
export type EnqueueOutcome = 'queued' | 'already_queued' | 'deduplicated';

/**
 * How a send is made idempotent and, optionally, throttled. `idempotencyKey` names the send: while a job sent under
 * the same key is alive, another send under it creates nothing. `dedupeKey` and `dedupeWindowSeconds` go together: a
 * send under a `dedupeKey` that was already used in the same window is dropped, which is how a burst of events about one
 * pull request becomes one job. A window is pg-boss's throttle slot of `dedupeWindowSeconds` seconds, starting at a
 * multiple of that length counted from the epoch (E07-S01): two sends a second apart on either side of a slot boundary
 * are both accepted, which the burst case does not mind. Neither of the two is optional on its own. A job type that the
 * queue serialises per key (`evaluate-pr`, one run per pull request at a time, E07-S02) carries that key as its only
 * pg-boss key, so there the window is per serialisation key: every `dedupeKey` of the same pull request shares it.
 */
export type EnqueueOptions = { readonly idempotencyKey: string } & (
  | { readonly dedupeKey?: undefined; readonly dedupeWindowSeconds?: undefined }
  | { readonly dedupeKey: string; readonly dedupeWindowSeconds: number }
);

export interface JobEnqueuer {
  /**
   * Sends `job` on the connection of `tx`, so the job commits or rolls back with everything else the transaction wrote:
   * a delivery recorded without its job, or a job without its delivery, cannot exist. Resolves `'already_queued'` or
   * `'deduplicated'` when nothing was sent because of `options`; rejects when the send failed, and the caller rolls back.
   */
  enqueue(tx: Transaction<Database>, job: Job, options: EnqueueOptions): Promise<EnqueueOutcome>;
}

/**
 * The running queue (E07-S01), as the composition root and the HTTP app see it: where the intake sends its jobs, whether
 * the queue works, and how it stops with the app.
 */
export interface JobQueue {
  readonly enqueuer: JobEnqueuer;
  /** False once the queue reported an error that a read of its queues has not cleared, and after `stop`. */
  isReady(): Promise<boolean>;
  /** Stops the workers, waiting for the jobs that run, and closes the queue's connections. Safe to call twice. */
  stop(): Promise<void>;
}
