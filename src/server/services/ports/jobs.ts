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
 * because a `dedupeKey` was used less than its window ago, so no job will ever run for this send. An implementation
 * answers `already_queued` before `deduplicated` when both apply. The two must not be confused: the first leaves a
 * delivery to its live job, the second leaves it to nobody.
 * @internal Exported for the adapters that implement the port (E07-S01) and the tests (Knip ignores `@internal` exports in production mode).
 */
export type EnqueueOutcome = 'queued' | 'already_queued' | 'deduplicated';

/**
 * How a send is made idempotent and, optionally, throttled. `idempotencyKey` names the send: while a job sent under
 * the same key is alive, another send under it creates nothing. `dedupeKey` and `dedupeWindowSeconds` go together: a
 * send under a `dedupeKey` that was used less than `dedupeWindowSeconds` ago is dropped, which is how a burst of events
 * about one pull request becomes one job. Neither of the two is optional on its own.
 * @internal Exported for the adapters that implement the port (E07-S01) and the tests (Knip ignores `@internal` exports in production mode).
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
