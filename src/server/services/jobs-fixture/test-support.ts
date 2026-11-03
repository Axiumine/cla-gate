// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql, type Transaction } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';
import { serialisationKey } from '../../adapters/jobs/serialisation.ts';
import { type JobEnvelope, jobEnvelopeSchema } from '../../domain/job-envelope.ts';
import { type Clock, systemClock } from '../ports/clock.ts';
import type { EnqueueOptions, EnqueueOutcome, JobEnqueuer, QueuedJob } from '../ports/jobs.ts';

// The enqueuer the tests of the webhook intake use until the pg-boss one exists (E06-S06, E07-S01): a real
// implementation of the `JobEnqueuer` port that writes into a table of the test database on the transaction it is given,
// so a job commits and rolls back with the delivery row exactly as a queue on the same connection would. The table is a
// test table: it is created by `createJobsTable` and exists in no migration.

/**
 * The table the fake sends into. `idempotency_key` is unique: a second send under the same key creates nothing. The columns
 * after it are what pg-boss keeps of a job for the limits of the port: its queue, its `singleton_key` (`queue_key`: the
 * serialisation key, or the coalesce key of a job that has none), the throttle slot it took (`slot_key` and `slot_on`, the
 * start of the window in seconds since the epoch) and its `state`: `created` until a test says it is `active` or `completed`.
 */
export async function createJobsTable(db: Kysely<Database>): Promise<void> {
  await sql`
    create table fake_jobs (
      id bigserial primary key,
      idempotency_key text not null unique,
      dedupe_key text,
      coalesce_key text,
      queue text not null,
      queue_key text,
      slot_key text,
      slot_on bigint,
      state text not null default 'created',
      sent_at timestamptz not null,
      job jsonb not null
    )`.execute(db);
}

/** One row of the table, as the tests look at it. */
export interface SentJob {
  readonly idempotencyKey: string;
  readonly dedupeKey: string | null;
  /** Present only for a job sent under a coalesce key. */
  readonly coalesceKey?: string;
  readonly job: JobEnvelope;
}

/** Every job sent and committed so far, in the order sent. */
export async function sentJobs(db: Kysely<Database>): Promise<SentJob[]> {
  const { rows } = await sql<{
    idempotency_key: string;
    dedupe_key: string | null;
    coalesce_key: string | null;
    job: unknown;
  }>`select idempotency_key, dedupe_key, coalesce_key, job from fake_jobs order by id`.execute(db);
  return rows.map((row) => ({
    idempotencyKey: row.idempotency_key,
    dedupeKey: row.dedupe_key,
    ...(row.coalesce_key === null ? {} : { coalesceKey: row.coalesce_key }),
    job: jobEnvelopeSchema.parse(row.job),
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
  readonly job: QueuedJob;
  readonly options: EnqueueOptions;
}

/** The states in which a job is still going to run, or is running: what pg-boss calls `created`, `retry` and `active`. */
const LIVE = ['created', 'retry', 'active'];

/** The throttle slot a send takes: pg-boss's key, and the start of the window of `seconds` that holds `now`, counted from the epoch. */
function slotOf(key: string, seconds: number, now: Date): { readonly key: string; readonly on: number } {
  return { key, on: Math.floor(now.getTime() / 1000 / seconds) * seconds };
}

/** The throttle slot a send takes, or `null` for a send under no rate limit. */
function slotOfSend(options: EnqueueOptions, queueKey: string | null, now: Date): ReturnType<typeof slotOf> | null {
  return options.dedupeKey === undefined || queueKey === null
    ? null
    : slotOf(queueKey, options.dedupeWindowSeconds, now);
}

/** What one try to write the row of a send came to. */
interface Attempt {
  /** The row was written. */
  readonly inserted: boolean;
  /** The state of the job that holds the idempotency key, when there is one. */
  readonly state: string | undefined;
}

/** What a send writes into its row: the keys it was given, the key pg-boss would store, and its throttle slot. */
interface SendRow {
  readonly job: QueuedJob;
  readonly options: EnqueueOptions;
  readonly queueKey: string | null;
  readonly slot: ReturnType<typeof slotOf> | null;
  readonly now: Date;
}

/** The statement fragments that tell whether a limit refuses the row: a waiting job holds the coalesce key, or the slot is taken. */
function limitsOf(send: SendRow) {
  const { job, options, queueKey, slot } = send;
  const waiting = sql`(${options.coalesceKey ?? null}::text is not null and exists (
    select 1 from fake_jobs where queue = ${job.type} and queue_key = ${queueKey} and state in ('created', 'retry')))`;
  const taken = sql`(${slot?.key ?? null}::text is not null and exists (
    select 1 from fake_jobs where queue = ${job.type} and slot_key = ${slot?.key ?? null} and slot_on = ${slot?.on ?? null}))`;
  return { waiting, taken };
}

/** The values of the row a send writes, in the order of the columns of `fake_jobs` the insert names. */
function valuesOf(send: SendRow) {
  const { job, options, queueKey, slot, now } = send;
  return sql`${options.idempotencyKey}, ${options.dedupeKey ?? null}, ${options.coalesceKey ?? null}, ${job.type}, ${queueKey},
    ${slot?.key ?? null}, ${slot?.on ?? null}, ${now}, ${JSON.stringify(job)}::jsonb`;
}

/**
 * Tries to write the row of a send, in one statement as pg-boss's `send` is: the row is written when no limit refuses it and the
 * idempotency key is free. The answer says which of them stopped it: the state of the job under the key, and whether a limit did.
 */
async function attempt(tx: Transaction<Database>, send: SendRow): Promise<Attempt> {
  const { waiting, taken } = limitsOf(send);
  const { rows } = await sql<{ inserted: boolean; state: string | null }>`
    with written as (
      insert into fake_jobs (idempotency_key, dedupe_key, coalesce_key, queue, queue_key, slot_key, slot_on, sent_at, job)
      select ${valuesOf(send)}
      where not ${waiting} and not ${taken}
      on conflict (idempotency_key) do nothing
      returning id)
    select exists (select 1 from written) as inserted,
      (select state from fake_jobs where idempotency_key = ${send.options.idempotencyKey}) as state`.execute(tx);
  const [row] = rows;
  return { inserted: row?.inserted === true, state: row?.state ?? undefined };
}

export interface FakeEnqueuer extends JobEnqueuer {
  readonly calls: EnqueueCall[];
}

/**
 * The fake queue, with the same answers as the pg-boss adapter. A send under an idempotency key whose job is alive is
 * `already_queued`, and one whose job is over replaces it. A send with a `coalesceKey` is `deduplicated` while a job of the
 * same queue and key has not started (the key is the serialisation key of a pull request on a serialised type). A send
 * under a `dedupeKey` is `deduplicated` when its slot, an epoch-aligned window of `dedupeWindowSeconds`, is taken by a job of
 * that queue and key, whatever became of it. Any other send writes one row.
 */
export function fakeEnqueuer(clock: Clock = systemClock): FakeEnqueuer {
  const calls: EnqueueCall[] = [];
  return {
    calls,
    async enqueue(tx, job, options): Promise<EnqueueOutcome> {
      calls.push({ job, options });
      const now = clock.now();
      const queueKey = serialisationKey(job) ?? options.coalesceKey ?? options.dedupeKey ?? null;
      const send = { job, options, queueKey, slot: slotOfSend(options, queueKey, now), now };
      const first = await attempt(tx, send);
      if (first.inserted) {
        return 'queued';
      }
      // A job that is alive keeps its key. With no job under the key a limit refused the row. A job that is over is replaced, as
      // the adapter deletes it and sends again: it no longer holds the slot it took, and a limit of another job still refuses.
      if (LIVE.includes(first.state ?? '')) {
        return 'already_queued';
      }
      if (first.state === undefined) {
        return 'deduplicated';
      }
      await sql`delete from fake_jobs where idempotency_key = ${options.idempotencyKey}`.execute(tx);
      return (await attempt(tx, send)).inserted ? 'queued' : 'deduplicated';
    },
  };
}

/** The state of every job the fake holds: a test that models a worker taking a job, or finishing it. */
export async function setJobStates(db: Kysely<Database>, state: 'active' | 'completed'): Promise<void> {
  await sql`update fake_jobs set state = ${state} where state in ('created', 'retry', 'active')`.execute(db);
}

/** How many jobs are alive (`created`, `retry` or `active`): the ones a worker has yet to finish. */
export async function liveJobCount(db: Kysely<Database>): Promise<number> {
  const { rows } = await sql`select id from fake_jobs where state in ('created', 'retry', 'active')`.execute(db);
  return rows.length;
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
