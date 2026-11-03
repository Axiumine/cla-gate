// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { PgBoss } from 'pg-boss';
import { expect, inject, onTestFinished, test, vi } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { deliveryIdSchema } from '../../domain/delivery-id.ts';
import { RETRY_LIMIT } from '../../domain/job-retry.ts';
import type { Job } from '../../domain/jobs.ts';
import type { DeadLetterPorts } from '../../services/dead-letter/dead-letter-registry.ts';
import { FakeReporter, githubWorld, INSTALLATION, JOB } from '../../services/evaluate-pr/test-support.ts';
import { commitSha } from '../../services/github-pull-contract/test-support.ts';
import { HandlerRegistry, type JobHandler } from '../../services/job-registry.ts';
import { systemClock } from '../../services/ports/clock.ts';
import { GitHubUnavailableError } from '../../services/ports/github-errors.ts';
import type { JobQueue } from '../../services/ports/jobs.ts';
import { createWebhookDeliveries, type WebhookDeliveries } from '../../services/webhook-deliveries.ts';
import { captureLogs, type LogCapture } from '../../test-support.ts';
import { createPgDatabase } from '../db/pg.ts';
import type { Database } from '../db/schema.ts';
import {
  migratedRuntimeDatabase,
  realPostgresRolesOnly,
  requireTestDatabaseUrl,
  seedTenant,
} from '../db/test-support.ts';
import { createLogger } from '../http/logger.ts';
import { runtimeBossOptions } from './boss.ts';
import { migrateJobQueues } from './migrate-queues.ts';
import { QUEUES, SCHEDULER_QUEUE } from './queues.ts';
import { startJobQueue } from './runtime.ts';

// Bounded retries and the dead-letter handler on a real PostgreSQL (E07-S05): the queues carry the bounds, a handler that
// always throws runs six times and one job reaches `job-dead-letter`, the dead-letter handler runs once and fails the Check
// Run of a dead evaluation, GitHub being down inside it retries it under the same bounds and ends with one line and no
// loop, and data that is no envelope is rejected without a retry. They need real connections and the runtime role, so
// they run in the CI `postgres` job and skip on PGlite; the lines they pass through are covered by the unit tests. The
// backoff is real in the queue (the first retry is 30 to 60 s away): the tests that need the next attempt now move the
// time of the job forward, which is all a clock would do.

vi.setConfig({ testTimeout: 180_000 });

/** How often a worker looks for a job: the shortest interval pg-boss accepts. */
const POLL_SECONDS = 0.5;
const DELIVERY = deliveryIdSchema.parse('7c9e6679-7425-40de-944b-e07fc1f90ae7');
const SUBJECT = { deliveryId: DELIVERY, event: 'pull_request', action: 'opened' };
const SYNC: Job = { type: 'sync-installation', githubInstallationId: parseGithubId(32_001) };
const FIVE_RETRIES = [0, 1, 2, 3, 4, 5];
const OUTAGE = new GitHubUnavailableError('GitHub answered 500');

const ownerUrl = (): string => requireTestDatabaseUrl(inject('testDatabaseUrl'));

/** The test database's URL, with every session switched to the runtime role as it connects. */
function runtimeUrl(): string {
  const url = new URL(ownerUrl());
  url.searchParams.set('options', '-c role=cla_app');
  return url.href;
}

interface JobRow {
  readonly state: string;
  readonly retry_count: number;
  readonly output: Record<string, unknown> | null;
  readonly data: Record<string, unknown>;
}

interface World {
  readonly owner: Kysely<Database>;
  /** The connection of the application: the runtime role. */
  readonly db: Kysely<Database>;
  readonly deliveries: WebhookDeliveries;
  readonly logs: LogCapture;
  readonly errors: Error[];
  /** Sends `job` under `key` in a transaction of its own that commits. */
  readonly enqueue: (job: Job, key: string) => Promise<void>;
  /** pg-boss as the runtime role, for what a test does by hand. */
  readonly raw: PgBoss;
  /** Sends `data` to `queue` as it is, whatever it holds. */
  readonly sendRaw: (queue: string, data: object) => Promise<void>;
  /** The jobs of `queue`, oldest first. */
  readonly jobs: (queue: string) => Promise<JobRow[]>;
  /** Makes every job of `queues` that waits for its retry due now: the time of the backoff, passed. */
  readonly fastForward: (...queues: string[]) => Promise<void>;
}

/** A fresh pgboss schema made by the migrate step; connections and the sending queue are closed after the test. */
async function world(): Promise<World> {
  const { db: owner } = await migratedRuntimeDatabase();
  await sql`drop schema if exists pgboss cascade`.execute(owner);
  const errors: Error[] = [];
  await migrateJobQueues({ connectionString: ownerUrl(), db: owner, onError: (error) => errors.push(error) });
  const logs = captureLogs();
  const db = createPgDatabase({ connectionString: runtimeUrl(), onError: (error) => errors.push(error) });
  const sender = await startJobQueue({ connectionString: runtimeUrl(), logger: createLogger({ logLevel: 'silent' }) });
  const raw = new PgBoss(runtimeBossOptions(runtimeUrl()));
  raw.on('error', (error) => errors.push(error));
  await raw.start();
  onTestFinished(async () => {
    await raw.stop({ graceful: true, timeout: 10_000 });
    await sender.stop();
    await db.destroy();
    expect(errors).toEqual([]);
  });
  return {
    owner,
    db,
    logs,
    errors,
    raw,
    deliveries: createWebhookDeliveries({ db, enqueuer: sender.enqueuer }),
    enqueue: (job, key) =>
      db.transaction().execute(async (tx) => {
        await sender.enqueuer.enqueue(tx, job, { idempotencyKey: key });
      }),
    sendRaw: async (queue, data) => {
      await raw.send(queue, data);
    },
    jobs: async (queue) =>
      (
        await sql<JobRow>`
          select state, retry_count, output, data from pgboss.job where name = ${queue} order by created_on, id`.execute(
          owner,
        )
      ).rows,
    fastForward: async (...queues) => {
      await sql`
        update pgboss.job set start_after = now() where name = any(${queues}) and state = 'retry'`.execute(owner);
    },
  };
}

/** The queue of the application with workers over `registry`, the dead-letter handlers over `deadLetter`, stopped after the test. */
async function startWorkers(
  w: World,
  registry: HandlerRegistry,
  deadLetter: DeadLetterPorts | undefined,
): Promise<JobQueue> {
  const queue = await startJobQueue({
    connectionString: runtimeUrl(),
    logger: createLogger({ logLevel: 'info' }, w.logs.destination),
    workers: {
      registry,
      markDeliveryProcessed: (deliveryId) => w.deliveries.markDeliveryProcessed(deliveryId),
      clock: systemClock,
      concurrency: 4,
      pollingIntervalSeconds: POLL_SECONDS,
      deadLetter,
    },
    graceMs: 1000,
  });
  onTestFinished(async () => {
    await queue.stop();
  });
  return queue;
}

/** Waits, polling in real time and moving the backoff of `queues` forward, until `check` stops throwing. */
const eventually = (w: World, queues: string[], check: () => Promise<void> | void): Promise<void> =>
  vi.waitFor(
    async () => {
      await w.fastForward(...queues);
      await check();
    },
    { timeout: 90_000, interval: 100 },
  );

/** A registry whose `sync-installation` handler is `handler`. */
function syncRegistry(handler: JobHandler<'sync-installation'>): HandlerRegistry {
  const registry = new HandlerRegistry();
  registry.register('sync-installation', handler);
  return registry;
}

const deadLines = (w: World, msg: string) => w.logs.lines().filter((line) => line['msg'] === msg);

realPostgresRolesOnly(
  'every queue is created with five retries 30 s apart and doubling, a 300 s expiry, the retention windows and job-dead-letter',
  async () => {
    const w = await world();
    const { rows } = await sql<{
      name: string;
      retry_limit: number;
      retry_delay: number;
      retry_backoff: boolean;
      expire_seconds: number;
      retention_seconds: number;
      deletion_seconds: number;
      dead_letter: string | null;
    }>`select name, retry_limit, retry_delay, retry_backoff, expire_seconds, retention_seconds, deletion_seconds,
         dead_letter from pgboss.queue order by name`.execute(w.owner);
    const byName = (a: string, b: string): number => a.localeCompare(b);
    expect(rows.map((row) => row.name).toSorted(byName)).toEqual([...QUEUES, SCHEDULER_QUEUE].toSorted(byName));
    for (const row of rows) {
      expect(row).toEqual({
        name: row.name,
        retry_limit: 5,
        retry_delay: 30,
        retry_backoff: true,
        expire_seconds: 300,
        retention_seconds: 14 * 86_400,
        deletion_seconds: 7 * 86_400,
        dead_letter: row.name === 'job-dead-letter' || row.name === SCHEDULER_QUEUE ? null : 'job-dead-letter',
      });
    }
  },
);

realPostgresRolesOnly(
  'a queue an older build created with other bounds is brought in line by the next migrate step, and a run after that changes nothing',
  async () => {
    const w = await world();
    await sql`update pgboss.queue set retry_limit = 2, retry_delay = 0, retry_backoff = false, dead_letter = null
      where name = 'sweep'`.execute(w.owner);
    const options = { connectionString: ownerUrl(), db: w.owner, onError: (error: Error) => w.errors.push(error) };
    expect(await migrateJobQueues(options)).toMatchObject({ created: [], updated: ['sweep'] });
    const { rows } = await sql<{
      retry_limit: number;
      retry_delay: number;
      retry_backoff: boolean;
      dead_letter: string;
    }>`
      select retry_limit, retry_delay, retry_backoff, dead_letter from pgboss.queue where name = 'sweep'`.execute(
      w.owner,
    );
    expect(rows).toEqual([{ retry_limit: 5, retry_delay: 30, retry_backoff: true, dead_letter: 'job-dead-letter' }]);
    expect(await migrateJobQueues(options)).toMatchObject({ created: [], updated: [] });
  },
);

realPostgresRolesOnly(
  'finished jobs do not pile up: the maintenance of pg-boss, run as the runtime role, deletes a finished job after seven days and one that never ran after fourteen',
  async () => {
    const w = await world();
    for (const n of [1, 2, 3, 4]) {
      await w.raw.send('sync-installation', { n });
    }
    // Which two jobs the fetch takes is the queue's business (the sends can share a millisecond): the test reads it back.
    const fetched = await w.raw.fetch<{ n: number }>('sync-installation', { batchSize: 2 });
    const finished = fetched.map(({ id, data }) => ({ id, n: data.n }));
    await w.raw.complete(
      'sync-installation',
      finished.map(({ id }) => id),
    );
    const waiting = [1, 2, 3, 4].filter((n) => !finished.some((job) => job.n === n));
    const windows = await sql<{ deletion: number; waiting: number }>`
      select distinct deletion_seconds as deletion, extract(epoch from keep_until - start_after)::int as waiting
      from pgboss.job where name = 'sync-installation'`.execute(w.owner);
    expect(windows.rows).toEqual([{ deletion: 7 * 86_400, waiting: 14 * 86_400 }]);
    // Time passes: the first finished job is 8 days old and the second 6; the first waiting job is 15 days old, the other new.
    for (const [index, { id }] of finished.entries()) {
      await sql`update pgboss.job set completed_on = now() - make_interval(days => ${index === 0 ? 8 : 6})
        where id = ${id}`.execute(w.owner);
    }
    for (const n of waiting.slice(0, 1)) {
      await sql`update pgboss.job set start_after = start_after - interval '15 days', keep_until = keep_until - interval '15 days'
        where name = 'sync-installation' and state = 'created' and (data->>'n')::int = ${n}`.execute(w.owner);
    }
    await w.raw.supervise('sync-installation');
    const left = await sql<{ n: number; state: string }>`
      select (data->>'n')::int as n, state from pgboss.job where name = 'sync-installation' order by 1`.execute(
      w.owner,
    );
    const kept = [
      ...finished.slice(1).map(({ n }) => ({ n, state: 'completed' })),
      ...waiting.slice(1).map((n) => ({ n, state: 'created' })),
    ];
    expect(left.rows).toEqual(kept.toSorted((a, b) => a.n - b.n));
  },
);

realPostgresRolesOnly('a job sent to a queue takes its bounds, and its first retry is 30 to 60 s away', async () => {
  const w = await world();
  const attempts: number[] = [];
  await startWorkers(
    w,
    syncRegistry((_job, { attempt }) => {
      attempts.push(attempt);
      return Promise.reject(new Error('GitHub answered 500'));
    }),
    undefined,
  );
  await w.enqueue(SYNC, 'bounds');
  await vi.waitFor(
    async () => {
      expect((await w.jobs('sync-installation')).map((job) => job.state)).toEqual(['retry']);
    },
    { timeout: 30_000, interval: 100 },
  );
  const { rows } = await sql<{
    retry_limit: number;
    retry_delay: number;
    retry_backoff: boolean;
    expire_seconds: number;
    dead_letter: string;
    wait: number;
  }>`select retry_limit, retry_delay, retry_backoff, expire_seconds, dead_letter,
       extract(epoch from start_after - now())::float as wait
     from pgboss.job where name = 'sync-installation'`.execute(w.owner);
  expect(rows[0]).toMatchObject({
    retry_limit: 5,
    retry_delay: 30,
    retry_backoff: true,
    expire_seconds: 300,
    dead_letter: 'job-dead-letter',
  });
  expect(rows[0]?.wait).toBeGreaterThan(25);
  expect(rows[0]?.wait).toBeLessThanOrEqual(60);
  expect(attempts).toEqual([0]);
});

realPostgresRolesOnly(
  'a handler that always throws runs exactly six times, then one job reaches job-dead-letter and its handler runs once',
  async () => {
    const w = await world();
    const attempts: number[] = [];
    await w.db
      .insertInto('webhook_deliveries')
      .values({ delivery_id: DELIVERY, event: 'installation', action: 'created' })
      .execute();
    await startWorkers(
      w,
      syncRegistry((_job, { attempt }) => {
        attempts.push(attempt);
        return Promise.reject(new Error('GitHub answered 500'));
      }),
      { db: w.db, evaluation: undefined },
    );
    await w.enqueue({ ...SYNC, deliveryId: DELIVERY }, DELIVERY);
    await eventually(w, ['sync-installation'], async () => {
      expect((await w.jobs('job-dead-letter')).map((job) => job.state)).toEqual(['completed']);
    });
    expect(attempts).toEqual(FIVE_RETRIES);
    const [original] = await w.jobs('sync-installation');
    expect(original).toMatchObject({ state: 'failed', retry_count: 5, output: { message: 'GitHub answered 500' } });
    const [dead] = await w.jobs('job-dead-letter');
    expect(dead).toMatchObject({ retry_count: 0, data: { type: 'sync-installation', deliveryId: DELIVERY } });
    expect(deadLines(w, 'job.dead_lettered')).toMatchObject([
      { level: 50, type: 'sync-installation', outcome: 'logged' },
    ]);
    // The delivery stays open: GitHub's redelivery sends the job again, and the dead one is replaced.
    const processed = await w.db
      .selectFrom('webhook_deliveries')
      .select('processed_at')
      .where('delivery_id', '=', DELIVERY)
      .executeTakeFirstOrThrow();
    expect(processed.processed_at).toBeNull();
    expect(await w.deliveries.record(SUBJECT, { ...SYNC, deliveryId: DELIVERY })).toBe('accepted');
    expect((await w.jobs('sync-installation')).map((job) => job.state)).toEqual(['created']);
  },
);

/** A tenant whose repository the dead evaluation names, as the runtime role would find it. */
async function tenant(w: World) {
  const seeded = await seedTenant(w.owner, 1);
  await sql`update installations set admission_status = 'admitted', admission_reason = null`.execute(w.owner);
  await w.owner
    .updateTable('repositories')
    .set({ enabled: true, cla_document_id: seeded.documentId })
    .where('installation_id', '=', seeded.installationId)
    .execute();
  return seeded;
}

/** An `evaluate-pr` handler that fails every attempt, and the GitHub and reporter that the dead-letter handler is given. */
function dyingEvaluation(w: World) {
  const registry = new HandlerRegistry();
  registry.register('evaluate-pr', () => Promise.reject(OUTAGE));
  const fake = githubWorld();
  const reporter = new FakeReporter();
  return { registry, fake, reporter, ports: { db: w.db, evaluation: () => ({ github: fake, reporter }) } };
}

realPostgresRolesOnly(
  'a dead evaluate-pr ends the Check Run as failure through the reporter, sets the row, and leaves its delivery open',
  async () => {
    const w = await world();
    await tenant(w);
    const { registry, reporter, ports } = dyingEvaluation(w);
    await startWorkers(w, registry, ports);
    await w.db
      .insertInto('webhook_deliveries')
      .values({ delivery_id: DELIVERY, event: 'pull_request', action: 'opened' })
      .execute();
    await w.deliveries.record(SUBJECT, { ...JOB, deliveryId: DELIVERY });
    await eventually(w, ['evaluate-pr'], async () => {
      expect(reporter.failures).toHaveLength(1);
      expect((await w.jobs('job-dead-letter')).map((job) => job.state)).toEqual(['completed']);
    });
    expect(reporter.failures[0]).toMatchObject({
      code: 'evaluation_failed',
      target: {
        githubInstallationId: INSTALLATION,
        headSha: commitSha(2),
        prNumber: JOB.prNumber,
        trigger: 'pull_request',
      },
    });
    expect(await w.owner.selectFrom('pr_evaluations').select(['head_sha', 'result', 'details']).execute()).toEqual([
      { head_sha: commitSha(2), result: 'failure', details: { code: 'evaluation_failed' } },
    ]);
    expect((await w.jobs('evaluate-pr')).map((job) => [job.state, job.retry_count])).toEqual([['failed', 5]]);
    const delivery = await w.db
      .selectFrom('webhook_deliveries')
      .select('processed_at')
      .where('delivery_id', '=', DELIVERY)
      .executeTakeFirstOrThrow();
    expect(delivery.processed_at).toBeNull();
    expect(deadLines(w, 'job.dead_lettered')).toMatchObject([{ type: 'evaluate-pr', outcome: 'reported' }]);
  },
);

realPostgresRolesOnly(
  'GitHub being down inside the dead-letter handler retries it under the same bounds, ends with one dead_letter_unhandled line, and starts no loop',
  async () => {
    const w = await world();
    await tenant(w);
    const { registry, fake, reporter, ports } = dyingEvaluation(w);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      fake.failNext('getRepositoryById', OUTAGE);
    }
    await startWorkers(w, registry, ports);
    await w.enqueue(JOB, 'down');
    await eventually(w, ['evaluate-pr', 'job-dead-letter'], async () => {
      expect((await w.jobs('job-dead-letter')).map((job) => job.state)).toEqual(['failed']);
    });
    const [dead] = await w.jobs('job-dead-letter');
    expect(dead).toMatchObject({ retry_count: 5, output: { message: 'GitHub answered 500' } });
    expect(deadLines(w, 'dead_letter.failed')).toHaveLength(6);
    expect(deadLines(w, 'dead_letter_unhandled')).toMatchObject([{ level: 50, type: 'evaluate-pr', attempt: 5 }]);
    expect(deadLines(w, 'job.dead_lettered')).toEqual([]);
    expect(reporter.failures).toEqual([]);
    expect(await w.owner.selectFrom('pr_evaluations').select('id').execute()).toEqual([]);
    const { rows } = await sql<{ name: string; jobs: number }>`
      select name, count(*)::int as jobs from pgboss.job group by name order by name`.execute(w.owner);
    expect(rows).toEqual([
      { name: 'evaluate-pr', jobs: 1 },
      { name: 'job-dead-letter', jobs: 1 },
    ]);
  },
);

realPostgresRolesOnly(
  'data that is no envelope is rejected without a retry: the original completes as rejected and a copy reaches job-dead-letter',
  async () => {
    const w = await world();
    await w.db
      .insertInto('webhook_deliveries')
      .values({ delivery_id: DELIVERY, event: 'installation', action: 'created' })
      .execute();
    const handler = vi.fn<JobHandler<'sync-installation'>>(() => Promise.resolve({ outcome: 'synced' }));
    const data = { type: 'sync-installation', githubInstallationId: -1, deliveryId: DELIVERY };
    await w.sendRaw('sync-installation', data);
    await startWorkers(w, syncRegistry(handler), { db: w.db, evaluation: undefined });
    await eventually(w, [], async () => {
      expect((await w.jobs('job-dead-letter')).map((job) => job.state)).toEqual(['completed']);
    });
    expect(await w.jobs('sync-installation')).toEqual([
      { state: 'completed', retry_count: 0, output: { rejected: 'invalid_payload' }, data },
    ]);
    expect(await w.jobs('job-dead-letter')).toEqual([
      { state: 'completed', retry_count: 0, output: { outcome: 'unrecognised' }, data },
    ]);
    expect(handler).not.toHaveBeenCalled();
    expect(deadLines(w, 'job.dead_lettered')).toMatchObject([
      { level: 50, type: 'sync-installation', outcome: 'unrecognised', issues: ['githubInstallationId:too_small'] },
    ]);
    const delivery = await w.db
      .selectFrom('webhook_deliveries')
      .select('processed_at')
      .where('delivery_id', '=', DELIVERY)
      .executeTakeFirstOrThrow();
    expect(delivery.processed_at).toBeNull();
  },
);

realPostgresRolesOnly(
  'a dead-letter queue nobody works keeps the dead jobs, so nothing is lost while the handlers are off',
  async () => {
    const w = await world();
    const attempts: number[] = [];
    await startWorkers(
      w,
      syncRegistry((_job, { attempt }) => {
        attempts.push(attempt);
        return Promise.reject(new Error('GitHub answered 500'));
      }),
      undefined,
    );
    await w.enqueue(SYNC, 'unworked');
    await eventually(w, ['sync-installation'], async () => {
      expect((await w.jobs('job-dead-letter')).map((job) => job.state)).toEqual(['created']);
    });
    expect(attempts).toEqual(FIVE_RETRIES);
  },
);

test('a job that always fails runs once and retries as often as the limit of the queues, which the tests below count', () => {
  expect(FIVE_RETRIES).toHaveLength(RETRY_LIMIT + 1);
  expect(FIVE_RETRIES.at(-1)).toBe(RETRY_LIMIT);
});
