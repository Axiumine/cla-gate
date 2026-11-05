// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { PgBoss } from 'pg-boss';
import { expect, inject, onTestFinished, test, vi } from 'vitest';
import { jobEnvelopeSchema } from '../../domain/job-envelope.ts';
import { HandlerRegistry } from '../../services/job-registry.ts';
import { systemClock } from '../../services/ports/clock.ts';
import { retentionSweepHandler } from '../../services/retention/retention-handler.ts';
import { DAY, failOnBatch, insertDelivery, sweptRows } from '../../services/retention/test-support.ts';
import { captureLogs, testConfig } from '../../test-support.ts';
import { createPgDatabase } from '../db/pg.ts';
import type { Database } from '../db/schema.ts';
import { insertSessionRow } from '../db/sessions-fixture/test-support.ts';
import { migratedRuntimeDatabase, realPostgresRolesOnly, requireTestDatabaseUrl } from '../db/test-support.ts';
import { createLogger } from '../http/logger.ts';
import { createPgBoss, runtimeBossOptions } from './boss.ts';
import { migrateJobQueues } from './migrate-queues.ts';
import { startJobQueue } from './runtime.ts';

// The retention sweep on a real PostgreSQL, over the queue of the application (E22-S04): the runtime role schedules the daily job,
// the scheduler puts one on the queue when it is due, a worker runs the sweep as the runtime role and deletes what is due, a
// failed run is retried within the bounded retries and finishes the work, and there is one sweep at a time. It needs real
// connections and the runtime role, so it runs in the CI `postgres` job and skips on PGlite; the code it goes through is covered
// by the unit tests.

vi.setConfig({ testTimeout: 120_000 });

/** How often a worker looks for a job, and the scheduler for a schedule that is due: the shortest interval pg-boss accepts. */
const POLL_SECONDS = 0.5;
const SCHEDULER_SECONDS = 1;
const SETTINGS = { webhookDeliveriesDays: 30, batchSize: 5000 };
const JOB = { type: 'retention-sweep' } as const;

test('the job the schedule and the tests send is a job of the catalogue', () => {
  expect(jobEnvelopeSchema.parse(JOB)).toEqual(JOB);
});

const ownerUrl = (): string => requireTestDatabaseUrl(inject('testDatabaseUrl'));

/** The test database's URL, with every session switched to the runtime role as it connects. */
function runtimeUrl(): string {
  const url = new URL(ownerUrl());
  url.searchParams.set('options', '-c role=cla_app');
  return url.href;
}

/** A user, and a delivery and a session each long past their retention, and a delivery that is still pending. */
async function seedRetention(owner: Kysely<Database>): Promise<void> {
  const user = await owner
    .insertInto('users')
    .values({ github_id: 7_700_001, login: 'login-7700001', name: 'Name 7700001', avatar_url: null })
    .returning('id')
    .executeTakeFirstOrThrow();
  const longAgo = new Date(Date.now() - 90 * DAY);
  await insertDelivery(owner, 'zzzz-old-delivery', longAgo);
  await insertDelivery(owner, 'zzzz-pending-delivery', null);
  await insertSessionRow(owner, user.id, 1, {
    createdAt: new Date(longAgo.getTime() - 30 * DAY),
    idleExpiresAt: longAgo,
    absoluteExpiresAt: longAgo,
  });
}

/** The queue schema made by the migrate step, the rows of {@link seedRetention}, the application's database as the runtime role and a way to start its queue. */
async function scene() {
  const { db: owner } = await migratedRuntimeDatabase();
  await sql`drop schema if exists pgboss cascade`.execute(owner);
  await migrateJobQueues({ connectionString: ownerUrl(), db: owner, onError: () => undefined });
  await seedRetention(owner);
  const logs = captureLogs();
  const logger = createLogger(testConfig(), logs.destination);
  const db = createPgDatabase({ connectionString: runtimeUrl(), onError: () => undefined });
  const raw = new PgBoss(runtimeBossOptions(runtimeUrl()));
  await raw.start();
  onTestFinished(async () => {
    await raw.stop({ graceful: true, timeout: 10_000 });
    await db.destroy();
    expect(logs.lines().filter((line) => line['msg'] === 'jobs.queue_error')).toEqual([]);
  });
  return {
    owner,
    db,
    raw,
    /** The queue of the application with its workers, the scheduler checking every second; stopped after the test unless the test stopped it. */
    start: async (registry: HandlerRegistry) => {
      const queue = await startJobQueue({
        connectionString: runtimeUrl(),
        logger,
        createBoss: (options) =>
          createPgBoss({
            ...options,
            cronMonitorIntervalSeconds: SCHEDULER_SECONDS,
            cronWorkerIntervalSeconds: SCHEDULER_SECONDS,
          }),
        workers: {
          registry,
          markDeliveryProcessed: () => Promise.resolve(),
          clock: systemClock,
          concurrency: 4,
          pollingIntervalSeconds: POLL_SECONDS,
          sweepIntervalMinutes: 0,
        },
      });
      onTestFinished(async () => {
        await queue.stop();
      });
      return queue;
    },
  };
}

type Scene = Awaited<ReturnType<typeof scene>>;

/** A registry with the handler of the retention sweep over `db`; `before` runs first in every job. */
function registryOver(db: Kysely<Database>, before: () => Promise<void> = () => Promise.resolve()): HandlerRegistry {
  const handler = retentionSweepHandler({ db, clock: systemClock, settings: SETTINGS });
  const registry = new HandlerRegistry();
  registry.register('retention-sweep', async (job, context) => {
    await before();
    return handler(job, context);
  });
  return registry;
}

const jobsOf = async (owner: Kysely<Database>) =>
  (
    await sql<{ state: string; retry_count: number; output: unknown }>`
    select state, retry_count, output from pgboss.job where name = 'retention-sweep' order by created_on, id`.execute(
      owner,
    )
  ).rows;

const eventually = (check: () => Promise<void> | void): Promise<void> =>
  vi.waitFor(check, { timeout: 60_000, interval: 200 });

/** What is left of the purged tables, and of the rows that must stay. */
async function remaining(owner: Kysely<Database>) {
  return {
    deliveries: (
      await owner.selectFrom('webhook_deliveries').select('delivery_id').orderBy('delivery_id').execute()
    ).map((row) => row.delivery_id),
    sessions: (await owner.selectFrom('sessions').select('id').execute()).length,
  };
}

realPostgresRolesOnly(
  'the runtime role schedules the retention sweep every day at 03:17 UTC, and a second start leaves the one schedule',
  async () => {
    const world: Scene = await scene();
    const schedule = async () =>
      (
        await sql<{ name: string; cron: string; timezone: string; data: unknown }>`
        select name, cron, timezone, data from pgboss.schedule where name = 'retention-sweep'`.execute(world.owner)
      ).rows;
    const expected = [{ name: 'retention-sweep', cron: '17 3 * * *', timezone: 'UTC', data: JOB }];
    await (await world.start(registryOver(world.db))).stop();
    expect(await schedule()).toEqual(expected);
    await world.start(registryOver(world.db));
    expect(await schedule()).toEqual(expected);
  },
);

realPostgresRolesOnly(
  'a schedule that is due puts one retention-sweep job on the queue, and the worker deletes what is due as the runtime role and keeps the rest',
  async () => {
    const world = await scene();
    await world.start(registryOver(world.db));
    // the cron of the schedule is not due until 03:17; one that is due every minute is, at once, for the scheduler to find
    await sql`update pgboss.schedule set cron = '* * * * *' where name = 'retention-sweep'`.execute(world.owner);
    await eventually(async () => {
      expect((await jobsOf(world.owner)).map((job) => job.state)).toEqual(['completed']);
    });
    expect((await jobsOf(world.owner))[0]?.output).toEqual({ outcome: 'swept' });
    expect(await remaining(world.owner)).toEqual({ deliveries: ['zzzz-pending-delivery'], sessions: 0 });
    expect((await sweptRows(world.owner)).map((row) => row.metadata)).toEqual([{ webhook_deliveries: 1, sessions: 1 }]);
  },
);

realPostgresRolesOnly(
  'a sweep that fails is retried within the bounded retries, and the retry finishes the work',
  async () => {
    const world = await scene();
    await world.start(registryOver(world.db.withPlugin(failOnBatch(1, new Error('the connection dropped')))));
    expect(await world.raw.send('retention-sweep', JOB)).not.toBeNull();
    await eventually(async () => {
      expect((await jobsOf(world.owner)).map((job) => [job.state, job.retry_count])).toEqual([['retry', 0]]);
    });
    expect(await remaining(world.owner)).toMatchObject({ sessions: 1 });
    await sql`update pgboss.job set start_after = now() where name = 'retention-sweep' and state = 'retry'`.execute(
      world.owner,
    );
    await eventually(async () => {
      expect((await jobsOf(world.owner)).map((job) => [job.state, job.retry_count])).toEqual([['completed', 1]]);
    });
    expect(await remaining(world.owner)).toEqual({ deliveries: ['zzzz-pending-delivery'], sessions: 0 });
    expect((await sweptRows(world.owner)).map((row) => row.metadata)).toEqual([{ webhook_deliveries: 1, sessions: 1 }]);
  },
);

realPostgresRolesOnly(
  'there is one retention sweep at a time: a second one is not queued while one waits or runs, and is when it is over',
  async () => {
    const world = await scene();
    expect(await world.raw.send('retention-sweep', JOB)).not.toBeNull();
    expect(await world.raw.send('retention-sweep', JOB)).toBeNull();
    const held = Promise.withResolvers<undefined>();
    await world.start(registryOver(world.db, () => held.promise));
    await eventually(async () => {
      expect((await jobsOf(world.owner)).map((job) => job.state)).toEqual(['active']);
    });
    expect(await world.raw.send('retention-sweep', JOB)).toBeNull();
    held.resolve(undefined);
    await eventually(async () => {
      expect((await jobsOf(world.owner)).map((job) => job.state)).toEqual(['completed']);
    });
    expect(await world.raw.send('retention-sweep', JOB)).not.toBeNull();
  },
);
