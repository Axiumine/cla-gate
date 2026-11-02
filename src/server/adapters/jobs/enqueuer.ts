// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import { type Db, fromKysely, type SendOptions } from 'pg-boss';
import type { EnqueueOptions, EnqueueOutcome, JobEnqueuer, QueuedJob } from '../../services/ports/jobs.ts';
import type { Database } from '../db/schema.ts';
import type { Boss } from './boss.ts';
import { jobIdFor } from './job-id.ts';
import type { QueueName } from './queues.ts';
import { serialisationKey } from './serialisation.ts';

// The pg-boss implementation of the `JobEnqueuer` port (E07-S01, port by E06-S06). The job is sent on the connection of
// the Kysely transaction the webhook intake opened, so it commits or rolls back together with the `webhook_deliveries`
// row: a delivery recorded without its job, or a job without its delivery, cannot exist.

/** The states in which a job is still going to run (or is running): pg-boss's `created`, `retry` and `active`. */
const LIVE_STATES: ReadonlySet<string> = new Set(['created', 'retry', 'active']);

/**
 * The send options of one job on `db`. The job id (made from the `idempotencyKey`) makes a second send under the same key
 * meet the first job's row. A job with a serialisation key (E07-S02) is sent with it as pg-boss's `singletonKey`, which
 * the `singleton` policy of its queue reads to run one job per key at a time. A `dedupeKey` becomes pg-boss's throttle:
 * one job per `singletonKey` in a window of `singletonSeconds`, a window that starts at a multiple of its length counted
 * from the epoch (so two sends a second apart on either side of a window boundary are both accepted). pg-boss has one key
 * per job, so on a serialised queue the throttle is per serialisation key: the window is shared by every dedupe key of
 * the same pull request, and the dedupe key itself is not stored. pg-boss reads the window as a whole number of seconds;
 * anything else is refused here instead of in the middle of a statement.
 */
function sendOptions(id: string, db: Db, serialisation: string | undefined, options: EnqueueOptions): SendOptions {
  const base = serialisation === undefined ? { id, db } : { id, db, singletonKey: serialisation };
  if (options.dedupeKey === undefined) {
    return base;
  }
  if (!Number.isSafeInteger(options.dedupeWindowSeconds) || options.dedupeWindowSeconds < 1) {
    throw new RangeError('dedupeWindowSeconds must be a whole number of seconds, at least 1');
  }
  return { ...base, singletonKey: serialisation ?? options.dedupeKey, singletonSeconds: options.dedupeWindowSeconds };
}

export class PgBossEnqueuer implements JobEnqueuer {
  readonly #boss: Boss;

  constructor(boss: Boss) {
    this.#boss = boss;
  }

  /**
   * Sends `job` to the queue of its type. Answers `queued` when the job was inserted. When nothing was inserted, the job
   * under the same id decides: one that is still going to run (`created`, `retry`, `active`) is `already_queued`, and
   * will finish what this send was for; one that is over (`completed`, `failed`, `cancelled`) is removed and the job is
   * sent again, so a delivery GitHub redelivers after its job died is not lost; with no such job a throttle window (or
   * a policy of the queue) dropped the send, which is `deduplicated`. `already_queued` is therefore answered first.
   */
  async enqueue(tx: Transaction<Database>, job: QueuedJob, options: EnqueueOptions): Promise<EnqueueOutcome> {
    const queue: QueueName = job.type;
    const id = jobIdFor(options.idempotencyKey);
    const db = fromKysely(tx);
    const send = sendOptions(id, db, serialisationKey(job), options);
    if ((await this.#boss.send(queue, job, send)) !== null) {
      return 'queued';
    }
    const [existing] = await this.#boss.findJobs(queue, { id, db });
    if (existing === undefined) {
      return 'deduplicated';
    }
    if (LIVE_STATES.has(existing.state)) {
      return 'already_queued';
    }
    await this.#boss.deleteJob(queue, id, { db });
    return (await this.#boss.send(queue, job, send)) === null ? 'deduplicated' : 'queued';
  }
}
