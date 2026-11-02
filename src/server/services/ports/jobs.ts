// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { GithubId } from '../../../shared/github-id.ts';
import type { Database } from '../../adapters/db/schema.ts';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
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

/**
 * A job the platform itself puts on the queue (E07-S08): every job of the catalogue a webhook can start, and the
 * `sweep-installation` job the scheduled sweep fans out. The `sweep` job is not in it: only the scheduler sends it.
 */
export type QueuedJob = Job | EnvelopeOf<'sweep-installation'>;

export interface JobEnqueuer {
  /**
   * Sends `job` on the connection of `tx`, so the job commits or rolls back with everything else the transaction wrote:
   * a delivery recorded without its job, or a job without its delivery, cannot exist. Resolves `'already_queued'` or
   * `'deduplicated'` when nothing was sent because of `options`; rejects when the send failed, and the caller rolls back.
   */
  enqueue(tx: Transaction<Database>, job: QueuedJob, options: EnqueueOptions): Promise<EnqueueOutcome>;
}

/**
 * The pull request whose queued work is dropped (E07-S06). The ids are the ones of the jobs' envelopes: the installation
 * is part of the match, so a repository id that belongs to another installation never selects its jobs.
 */
export interface PendingWorkTarget {
  readonly githubInstallationId: GithubId;
  readonly githubRepoId: GithubId;
  readonly prNumber: number;
  /**
   * The head SHAs the pull request has had. An `evaluate-head-sha` job names a head SHA and no pull request, so the jobs of
   * a pull request are the ones that name one of its head SHAs.
   */
  readonly headShas: readonly string[];
}

/** What the handler of a closed pull request needs of the queue (E07-S06): to drop the jobs that wait for it. */
export interface PendingJobs {
  /**
   * Cancels the `evaluate-pr` and `recheck-comment` jobs of the pull request and the `evaluate-head-sha` jobs of its head
   * SHAs that are waiting, which are the queued ones and the ones waiting to be retried. A job that is running is not
   * touched: it ends itself when it finds the pull request closed. Safe to call again: a second call finds nothing.
   * @returns how many jobs were cancelled.
   */
  cancelForPullRequest(target: PendingWorkTarget): Promise<number>;
}

/**
 * How a shutdown of the queue ended (E07-S03): `drained` when every running job finished inside the grace period,
 * `aborted` when one was still running at its end and was aborted (it is retried after a restart). The process exit code
 * is 0 for the first and 1 for the second.
 */
export type StopOutcome = 'drained' | 'aborted';

/**
 * The running queue (E07-S01), as the composition root and the HTTP app see it: where the intake sends its jobs, whether
 * the queue works, and how it stops with the app.
 */
export interface JobQueue {
  readonly enqueuer: JobEnqueuer;
  /** False once the queue reported an error that a read of its queues has not cleared, when a queue of the application is missing, and after `stop`. */
  isReady(): Promise<boolean>;
  /**
   * Stops the workers, waiting for the jobs that run (30 s at most, E07-S03), and closes the queue's connections. Safe to
   * call twice: every call answers the first one's outcome.
   */
  stop(): Promise<StopOutcome>;
}
