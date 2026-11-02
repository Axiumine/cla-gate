// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { PgBoss } from 'pg-boss';
import { pino } from 'pino';
import { expect, inject, onTestFinished, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { deliveryIdSchema } from '../../domain/delivery-id.ts';
import type { Job } from '../../domain/jobs.ts';
import { createWebhookDeliveries } from '../../services/webhook-deliveries.ts';
import { runMigrateCli } from '../db/migrate-cli.ts';
import { createPgDatabase } from '../db/pg.ts';
import type { Database } from '../db/schema.ts';
import {
  MIGRATIONS_DIRECTORY,
  migratedRuntimeDatabase,
  realPostgresRolesOnly,
  requireTestDatabaseUrl,
} from '../db/test-support.ts';
import { runtimeBossOptions } from './boss.ts';
import { migrateJobQueues } from './migrate-queues.ts';
import { MissingQueuesError } from './queue-check.ts';
import { QUEUES } from './queues.ts';
import { startJobQueue } from './runtime.ts';

// The pg-boss runtime and the migrate step on a real PostgreSQL (E07-S01): what the owner's step installs, what the
// runtime role `cla_app` can and cannot do on the pgboss schema, and a webhook redelivery that finds the queue again. They
// need real connections and real roles, so they run in the CI `postgres` job and skip on PGlite; the lines they pass
// through are covered by the unit tests with a fake pg-boss.

const SILENT = pino({ level: 'silent' });
const DENIED = { code: '42501' };
/** A failed job stays failed: with retries left it would wait to run again and count as live. */
const NO_RETRY = { retryLimit: 0 };
/** The queues the migrate step creates on an empty schema, in the order it creates them: the dead-letter queue first (E07-S05). */
const CREATED = ['job-dead-letter', ...QUEUES.filter((name) => name !== 'job-dead-letter')];
const DELIVERY = deliveryIdSchema.parse('5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c');
const SYNC: Job = { type: 'sync-installation', githubInstallationId: parseGithubId(32_001), deliveryId: DELIVERY };
const SUBJECT = { deliveryId: DELIVERY, event: 'installation', action: 'created' };

const ownerUrl = (): string => requireTestDatabaseUrl(inject('testDatabaseUrl'));

/** The test database's URL, with every session switched to the runtime role as it connects. */
function runtimeUrl(): string {
  const url = new URL(ownerUrl());
  url.searchParams.set('options', '-c role=cla_app');
  return url.href;
}

/** The owner's connection on a database with the application's tables, the runtime role and no pgboss schema. */
async function withoutPgboss(): Promise<Kysely<Database>> {
  const { db } = await migratedRuntimeDatabase();
  await sql`drop schema if exists pgboss cascade`.execute(db);
  return db;
}

/** {@link withoutPgboss}, then the migrate step: the schema, the queues and the grants. */
async function withPgboss(): Promise<Kysely<Database>> {
  const db = await withoutPgboss();
  const errors: Error[] = [];
  await migrateJobQueues({ connectionString: ownerUrl(), db, onError: (error) => errors.push(error) });
  expect(errors).toEqual([]);
  return db;
}

/** A connection that is the runtime role from its first statement; it fails the test if its pool reports an error. */
function runtimeDatabase(): Kysely<Database> {
  const errors: Error[] = [];
  const db = createPgDatabase({ connectionString: runtimeUrl(), onError: (error) => errors.push(error) });
  onTestFinished(async () => {
    await db.destroy();
    expect(errors).toEqual([]);
  });
  return db;
}

async function liveJobs(owner: Kysely<Database>): Promise<number> {
  const { rows } = await sql<{ n: number }>`
    select count(*)::int as n from pgboss.job where state in ('created', 'retry', 'active')`.execute(owner);
  return rows[0]?.n ?? 0;
}

realPostgresRolesOnly(
  'the migrate step installs the pgboss schema and every queue, and a second run changes nothing',
  async () => {
    const owner = await withoutPgboss();
    const first = await migrateJobQueues({ connectionString: ownerUrl(), db: owner, onError: () => undefined });
    expect(first).toEqual({ created: CREATED, updated: [], grants: 'granted' });
    const names = await sql<{ name: string }>`select name from pgboss.queue`.execute(owner);
    const byName = (a: string, b: string): number => a.localeCompare(b);
    expect(names.rows.map((row) => row.name).toSorted(byName)).toEqual(QUEUES.toSorted(byName));
    const second = await migrateJobQueues({ connectionString: ownerUrl(), db: owner, onError: () => undefined });
    expect(second).toEqual({ created: [], updated: [], grants: 'granted' });
  },
);

realPostgresRolesOnly('yarn db:migrate runs the queue step after the SQL files and says what it created', async () => {
  const owner = await withoutPgboss();
  await sql`drop schema public cascade`.execute(owner);
  await sql`create schema public`.execute(owner);
  const out: string[] = [];
  const err: string[] = [];
  const env = { MIGRATION_DATABASE_URL: ownerUrl() };
  expect(
    await runMigrateCli({ env, directory: MIGRATIONS_DIRECTORY, out: (l) => out.push(l), err: (l) => err.push(l) }),
  ).toBe(0);
  expect(out.at(-1)).toBe(`job queues created: ${CREATED.join(', ')}`);
  expect(
    await runMigrateCli({ env, directory: MIGRATIONS_DIRECTORY, out: (l) => out.push(l), err: (l) => err.push(l) }),
  ).toBe(0);
  expect(out.at(-1)).toBe('job queues: up to date');
  expect(err).toEqual([]);
});

realPostgresRolesOnly(
  'the runtime role owns nothing in the pgboss schema and has no right to its structure',
  async () => {
    await withPgboss();
    const owned = await sql<{ n: number }>`
    select count(*)::int as n from pg_class where relnamespace = 'pgboss'::regnamespace and pg_get_userbyid(relowner) = 'cla_app'`.execute(
      runtimeDatabase(),
    );
    expect(owned.rows).toEqual([{ n: 0 }]);
  },
);

const STRUCTURE = [
  ['ALTER of the job table', sql`alter table pgboss.job add column extra integer`],
  ['ALTER of the queue table', sql`alter table pgboss.queue add column extra integer`],
  ['ALTER of the version table', sql`alter table pgboss.version add column extra integer`],
  ['DROP of the job table', sql`drop table pgboss.job cascade`],
  ['DROP of the queue table', sql`drop table pgboss.queue cascade`],
  ['DROP of the version table', sql`drop table pgboss.version cascade`],
  ['DROP of a function', sql`drop function pgboss.job_now()`],
  ['TRUNCATE of the job table', sql`truncate pgboss.job`],
  ['TRUNCATE of the queue table', sql`truncate pgboss.queue`],
  ['creating a table in the schema', sql`create table pgboss.not_allowed (id integer)`],
  ['dropping the schema', sql`drop schema pgboss cascade`],
] as const;

test('the refused operations are named once each, so each is registered as a test of its own', () => {
  const operations = STRUCTURE.map(([operation]) => operation);
  expect(new Set(operations).size).toBe(operations.length);
});

for (const [operation, statement] of STRUCTURE) {
  realPostgresRolesOnly(`the runtime role cannot do an ${operation} (permission denied)`, async () => {
    const owner = await withPgboss();
    await expect(statement.execute(runtimeDatabase())).rejects.toMatchObject(DENIED);
    const intact = await sql<{ n: number }>`select count(*)::int as n from pgboss.queue`.execute(owner);
    expect(intact.rows).toEqual([{ n: QUEUES.length }]);
  });
}

realPostgresRolesOnly(
  'the runtime role cannot create a partitioned queue, the one kind of queue that is DDL',
  async () => {
    const owner = await withPgboss();
    const errors: Error[] = [];
    const boss = new PgBoss(runtimeBossOptions(runtimeUrl()));
    boss.on('error', (error) => errors.push(error));
    await boss.start();
    onTestFinished(async () => {
      await boss.stop();
    });
    await expect(boss.createQueue('partitioned', { partition: true })).rejects.toMatchObject(DENIED);
    const left = await sql<{
      n: number;
    }>`select count(*)::int as n from pgboss.queue where name = 'partitioned'`.execute(owner);
    expect(left.rows).toEqual([{ n: 0 }]);
    expect(errors).toEqual([]);
  },
);

realPostgresRolesOnly(
  'the runtime starts pg-boss without creating or migrating anything: no schema, no start',
  async () => {
    const owner = await withoutPgboss();
    await expect(startJobQueue({ connectionString: runtimeUrl(), logger: SILENT })).rejects.toThrow(
      /pg-boss is not installed/,
    );
    const schema = await sql<{ found: string | null }>`select to_regnamespace('pgboss')::text as found`.execute(owner);
    expect(schema.rows).toEqual([{ found: null }]);
  },
);

realPostgresRolesOnly('the runtime refuses to start when a queue is missing and names it', async () => {
  const owner = await withPgboss();
  await sql`delete from pgboss.queue where name in ('sweep', 'close-pr')`.execute(owner);
  const error = await startJobQueue({ connectionString: runtimeUrl(), logger: SILENT }).catch(
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(MissingQueuesError);
  expect(error).toMatchObject({ queues: ['close-pr', 'sweep'] });
});

realPostgresRolesOnly(
  'the runtime role sends, fetches, completes, fails, cancels and supervises without an error',
  async () => {
    const owner = await withPgboss();
    const errors: Error[] = [];
    const boss = new PgBoss(runtimeBossOptions(runtimeUrl()));
    boss.on('error', (error) => errors.push(error));
    await boss.start();
    onTestFinished(async () => {
      await boss.stop();
      expect(errors).toEqual([]);
    });
    const [done, failed, cancelled] = [
      await boss.send('sweep', { n: 1 }, NO_RETRY),
      await boss.send('sweep', { n: 2 }, NO_RETRY),
      await boss.send('sweep', { n: 3 }, NO_RETRY),
    ];
    expect([done, failed, cancelled].every((id) => typeof id === 'string')).toBe(true);
    const fetched = await boss.fetch('sweep', { batchSize: 2 });
    expect(fetched).toHaveLength(2);
    await boss.complete('sweep', fetched.map((job) => job.id).slice(0, 1));
    await boss.fail('sweep', fetched.map((job) => job.id).slice(1));
    await boss.cancel('sweep', cancelled ?? '');
    await boss.supervise('sweep');
    const states = await sql<{ n: number }>`select count(*)::int as n from pgboss.job where name = 'sweep'`.execute(
      owner,
    );
    expect(states.rows).toEqual([{ n: 3 }]);
    // The job that failed with no retry left was moved to the dead-letter queue by the runtime role (E07-S05).
    const live = await sql<{ name: string }>`
      select name from pgboss.job where state in ('created', 'retry', 'active')`.execute(owner);
    expect(live.rows).toEqual([{ name: 'job-dead-letter' }]);
  },
);

realPostgresRolesOnly(
  'a webhook redelivery finds its job again after the job is lost, and drops it when the job finished',
  async () => {
    const owner = await withPgboss();
    const queue = await startJobQueue({ connectionString: runtimeUrl(), logger: SILENT });
    onTestFinished(async () => {
      await queue.stop();
    });
    const deliveries = createWebhookDeliveries({ db: runtimeDatabase(), enqueuer: queue.enqueuer });
    expect(await deliveries.record(SUBJECT, SYNC)).toBe('accepted');
    expect(await deliveries.record(SUBJECT, SYNC)).toBe('duplicate');
    expect(await liveJobs(owner)).toBe(1);
    await sql`update pgboss.job set state = 'failed' where name = 'sync-installation'`.execute(owner);
    expect(await liveJobs(owner)).toBe(0);
    expect(await deliveries.record(SUBJECT, SYNC)).toBe('accepted');
    expect(await liveJobs(owner)).toBe(1);
    await deliveries.markDeliveryProcessed(DELIVERY);
    expect(await deliveries.record(SUBJECT, SYNC)).toBe('duplicate');
    expect(await liveJobs(owner)).toBe(1);
  },
);

realPostgresRolesOnly(
  'without the queue the webhook intake fails, and a redelivery is accepted once the queue exists',
  async () => {
    const owner = await withoutPgboss();
    const db = runtimeDatabase();
    const missing = { enqueue: () => Promise.reject(new Error('no queue')) };
    await expect(createWebhookDeliveries({ db, enqueuer: missing }).record(SUBJECT, SYNC)).rejects.toThrow('no queue');
    expect(await db.selectFrom('webhook_deliveries').select('delivery_id').execute()).toEqual([]);
    await migrateJobQueues({ connectionString: ownerUrl(), db: owner, onError: () => undefined });
    const queue = await startJobQueue({ connectionString: runtimeUrl(), logger: SILENT });
    onTestFinished(async () => {
      await queue.stop();
    });
    expect(await createWebhookDeliveries({ db, enqueuer: queue.enqueuer }).record(SUBJECT, SYNC)).toBe('accepted');
    expect(await liveJobs(owner)).toBe(1);
  },
);
