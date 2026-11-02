// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';
import { type Job, jobSchema } from '../../domain/jobs.ts';
import { type Clock, systemClock } from '../ports/clock.ts';
import type { EnqueueOptions, EnqueueOutcome, JobEnqueuer } from '../ports/jobs.ts';

// The enqueuer the tests of the webhook intake use until the pg-boss one exists (E06-S06, E07-S01): a real
// implementation of the `JobEnqueuer` port that writes into a table of the test database on the transaction it is given,
// so a job commits and rolls back with the delivery row exactly as a queue on the same connection would. The table is a
// test table: it is created by `createJobsTable` and exists in no migration.

/** The table the fake sends into. `idempotency_key` is unique: a second send under the same key creates nothing. */
export async function createJobsTable(db: Kysely<Database>): Promise<void> {
  await sql`
    create table fake_jobs (
      id bigserial primary key,
      idempotency_key text not null unique,
      dedupe_key text,
      sent_at timestamptz not null,
      job jsonb not null
    )`.execute(db);
}

/** One row of the table, as the tests look at it. */
export interface SentJob {
  readonly idempotencyKey: string;
  readonly dedupeKey: string | null;
  readonly job: Job;
}

/** Every job sent and committed so far, in the order sent. */
export async function sentJobs(db: Kysely<Database>): Promise<SentJob[]> {
  const { rows } = await sql<{
    idempotency_key: string;
    dedupe_key: string | null;
    job: unknown;
  }>`select idempotency_key, dedupe_key, job from fake_jobs order by id`.execute(db);
  return rows.map((row) => ({
    idempotencyKey: row.idempotency_key,
    dedupeKey: row.dedupe_key,
    job: jobSchema.parse(row.job),
  }));
}

/** How many jobs have been sent and committed. */
export async function jobCount(db: Kysely<Database>): Promise<number> {
  const { rows } = await sql`select id from fake_jobs`.execute(db);
  return rows.length;
}

/** The queue loses its jobs, as it does when they fail for good, are dead-lettered or expire: the key of each can be sent again. */
export async function dropJobs(db: Kysely<Database>): Promise<void> {
  await sql`delete from fake_jobs`.execute(db);
}

/** Forgets every delivery and every job, for a test file that shares one database among its tests. */
export async function clearRecords(db: Kysely<Database>): Promise<void> {
  await dropJobs(db);
  await db.deleteFrom('webhook_deliveries').execute();
}

/** Every recorded delivery, oldest first: the columns of `webhook_deliveries` and nothing else. */
export function deliveryRows(db: Kysely<Database>) {
  return db.selectFrom('webhook_deliveries').selectAll().orderBy('received_at').orderBy('delivery_id').execute();
}

/** A call to `enqueue`, kept in the order made. */
interface EnqueueCall {
  readonly job: Job;
  readonly options: EnqueueOptions;
}

export interface FakeEnqueuer extends JobEnqueuer {
  readonly calls: EnqueueCall[];
}

/**
 * The fake queue. A send under an idempotency key that is already in the table, or under a `dedupeKey` used less than
 * `dedupeWindowSeconds` before by `clock`, is `deduplicated` and writes nothing; any other send writes one row.
 */
export function fakeEnqueuer(clock: Clock = systemClock): FakeEnqueuer {
  const calls: EnqueueCall[] = [];
  return {
    calls,
    async enqueue(tx, job, options): Promise<EnqueueOutcome> {
      calls.push({ job, options });
      const now = clock.now();
      if (options.dedupeKey !== undefined) {
        const since = new Date(now.getTime() - options.dedupeWindowSeconds * 1000);
        const { rows } =
          await sql`select 1 from fake_jobs where dedupe_key = ${options.dedupeKey} and sent_at > ${since}`.execute(tx);
        if (rows.length > 0) {
          return 'deduplicated';
        }
      }
      const { rows } = await sql`
        insert into fake_jobs (idempotency_key, dedupe_key, sent_at, job)
        values (${options.idempotencyKey}, ${options.dedupeKey ?? null}, ${now}, ${JSON.stringify(job)}::jsonb)
        on conflict (idempotency_key) do nothing
        returning id`.execute(tx);
      return rows.length > 0 ? 'queued' : 'deduplicated';
    },
  };
}

export interface SwitchableEnqueuer extends JobEnqueuer {
  /** From now on every send writes through to the inner enqueuer and then fails with `error`; `undefined` makes sends succeed again. */
  readonly failWith: (error: Error | undefined) => void;
}

/** An enqueuer that sends through `inner` and, while told to, fails after the send: a queue that goes down and comes back. */
export function switchableEnqueuer(inner: JobEnqueuer): SwitchableEnqueuer {
  let error: Error | undefined;
  return {
    failWith(next) {
      error = next;
    },
    async enqueue(tx, job, options) {
      const outcome = await inner.enqueue(tx, job, options);
      if (error !== undefined) {
        throw error;
      }
      return outcome;
    },
  };
}

/** An enqueuer that sends through `inner` and then fails, as a queue does that loses its connection after the send. */
export function failingAfterSend(inner: JobEnqueuer, error: Error): JobEnqueuer {
  const queue = switchableEnqueuer(inner);
  queue.failWith(error);
  return queue;
}

/** An enqueuer that reports every send as `deduplicated` and writes nothing. */
export const droppingEnqueuer: JobEnqueuer = {
  enqueue: () => Promise.resolve('deduplicated'),
};
