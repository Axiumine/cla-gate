// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { setTimeout as sleep } from 'node:timers/promises';
import { type Kysely, sql } from 'kysely';
import { PgBoss } from 'pg-boss';
import { pino } from 'pino';
import { expect, inject, onTestFinished, test, vi } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { boot } from '../../boot.ts';
import { type DeliveryId, deliveryIdSchema } from '../../domain/delivery-id.ts';
import type { Job } from '../../domain/jobs.ts';
import { HandlerRegistry, type JobHandler } from '../../services/job-registry.ts';
import { systemClock } from '../../services/ports/clock.ts';
import type { JobQueue } from '../../services/ports/jobs.ts';
import { createWebhookDeliveries, type WebhookDeliveries } from '../../services/webhook-deliveries.ts';
import { captureLogs, FakeProcess, freePort } from '../../test-support.ts';
import { createPgDatabase } from '../db/pg.ts';
import type { Database } from '../db/schema.ts';
import { migratedRuntimeDatabase, realPostgresRolesOnly, requireTestDatabaseUrl } from '../db/test-support.ts';
import { runtimeBossOptions } from './boss.ts';
import { migrateJobQueues } from './migrate-queues.ts';
import { STOP_GRACE_MS, startJobQueue } from './runtime.ts';

// The workers on a real PostgreSQL (E07-S03): a slow job finishes before the process exits on SIGTERM, a job stuck past
// the grace period is aborted and runs exactly once after a restart, a handler that rejects fails its job and leaves
// the process up, the concurrency is a cap, an invalid payload fails for good, and a job type nobody handles keeps its
// jobs. They need real connections and the runtime role, so they run in the CI `postgres` job and skip on PGlite; the
// lines they pass through are covered by the unit tests with a fake pg-boss. The sends go through the enqueuer of the
// application, the workers are its own, started as the runtime role, and the queues come from the migrate step.

vi.setConfig({ testTimeout: 120_000 });

const SILENT = pino({ level: 'silent' });
/** How often a worker looks for a job: the shortest interval pg-boss accepts. */
const POLL_SECONDS = 0.5;
const GRACE_MS = 1000;
const DELIVERY = deliveryIdSchema.parse('7c9e6679-7425-40de-944b-e07fc1f90ae7');
const SUBJECT = { deliveryId: DELIVERY, event: 'installation', action: 'created' };
const sync = (installation: number, deliveryId?: DeliveryId): Job => ({
  type: 'sync-installation',
  githubInstallationId: parseGithubId(installation),
  ...(deliveryId === undefined ? {} : { deliveryId }),
});
const SYNC = sync(32_001, DELIVERY);
const DONE = { outcome: 'synced' };

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
  /** The connection of the application: the runtime role. */
  readonly db: Kysely<Database>;
  /** Records a webhook delivery and sends its job in one transaction, as the intake does. */
  readonly deliveries: WebhookDeliveries;
  /** Sends `job` under `key` in a transaction of its own that commits. */
  readonly enqueue: (job: Job, key: string) => Promise<void>;
  /** Sends `data` to `queue` as it is, whatever it holds. */
  readonly sendRaw: (queue: string, data: object) => Promise<void>;
  /** The jobs of `queue`, oldest first. */
  readonly jobs: (queue: string) => Promise<JobRow[]>;
  /** When the delivery was marked processed: null while it is not. */
  readonly processedAt: (deliveryId: DeliveryId) => Promise<Date | null>;
  /** Deletes the row of `queue`, as a migration that went wrong would. */
  readonly dropQueue: (queue: string) => Promise<void>;
  /** Makes every job of `queue` that waits for its retry due now: the backoff of the queue (30 s or more, E07-S05), passed. */
  readonly fastForward: (queue: string) => Promise<void>;
}

/** A fresh pgboss schema made by the migrate step; connections and the sending queue are closed after the test. */
async function world(): Promise<World> {
  const { db: owner } = await migratedRuntimeDatabase();
  await sql`drop schema if exists pgboss cascade`.execute(owner);
  const errors: Error[] = [];
  await migrateJobQueues({ connectionString: ownerUrl(), db: owner, onError: (error) => errors.push(error) });
  const db = createPgDatabase({ connectionString: runtimeUrl(), onError: (error) => errors.push(error) });
  const sender = await startJobQueue({ connectionString: runtimeUrl(), logger: SILENT });
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
    db,
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
    processedAt: async (deliveryId) =>
      (
        await db
          .selectFrom('webhook_deliveries')
          .select('processed_at')
          .where('delivery_id', '=', deliveryId)
          .executeTakeFirstOrThrow()
      ).processed_at,
    dropQueue: async (queue) => {
      await sql`delete from pgboss.queue where name = ${queue}`.execute(owner);
    },
    fastForward: async (queue) => {
      await sql`update pgboss.job set start_after = now() where name = ${queue} and state = 'retry'`.execute(owner);
    },
  };
}

/** A registry whose `sync-installation` handler is `handler`. */
function syncRegistry(handler: JobHandler<'sync-installation'>): HandlerRegistry {
  const registry = new HandlerRegistry();
  registry.register('sync-installation', handler);
  return registry;
}

interface Options {
  readonly concurrency?: number;
  readonly graceMs?: number;
}

/** The queue of the application with its workers over `registry`, stopped after the test unless the test stopped it. */
async function startWorkers(w: World, registry: HandlerRegistry, options: Options = {}): Promise<JobQueue> {
  const queue = await startJobQueue({
    connectionString: runtimeUrl(),
    logger: SILENT,
    workers: {
      registry,
      markDeliveryProcessed: (deliveryId) => w.deliveries.markDeliveryProcessed(deliveryId),
      clock: systemClock,
      concurrency: options.concurrency ?? 4,
      pollingIntervalSeconds: POLL_SECONDS,
    },
    graceMs: options.graceMs ?? GRACE_MS,
  });
  onTestFinished(async () => {
    await queue.stop();
  });
  return queue;
}

/** The whole server of the application on the real database, its workers running `registry`; closed after the test. */
async function bootServer(registry: HandlerRegistry, graceMs = GRACE_MS) {
  const logs = captureLogs();
  const signals = new FakeProcess();
  const server = await boot({
    env: { DATABASE_URL: runtimeUrl(), HOST: '127.0.0.1', PORT: String(await freePort()), LOG_LEVEL: 'info' },
    signals,
    createDb: () => createPgDatabase({ connectionString: runtimeUrl(), onError: () => undefined }),
    createJobQueue: (config, logger, workers) =>
      startJobQueue({
        connectionString: config.databaseUrl.reveal(),
        logger,
        workers: { ...workers, registry, pollingIntervalSeconds: POLL_SECONDS },
        graceMs,
      }),
    reconcileOnStart: false,
    logDestination: logs.destination,
  });
  if (server === undefined) {
    throw new Error('the server did not start');
  }
  onTestFinished(async () => {
    await server.close();
  });
  return { server, signals, logs };
}

/** Waits, polling in real time, until `check` stops throwing. */
const eventually = (check: () => Promise<void> | void): Promise<void> =>
  vi.waitFor(check, { timeout: 60_000, interval: 100 });

test('the registry of these tests binds one type, so every other queue has no consumer', () => {
  expect(syncRegistry(() => Promise.resolve(DONE)).types()).toEqual(['sync-installation']);
});

const statesOf = async (w: World, queue: string): Promise<string[]> => (await w.jobs(queue)).map((job) => job.state);

realPostgresRolesOnly(
  'a slow job finishes before the process exits on SIGTERM, and then its delivery is processed',
  async () => {
    const w = await world();
    const started = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const events: string[] = [];
    const { server, signals } = await bootServer(
      syncRegistry(async () => {
        started.resolve(undefined);
        await release.promise;
        events.push('job finished');
        return DONE;
      }),
      STOP_GRACE_MS,
    );
    await w.deliveries.record(SUBJECT, SYNC);
    await started.promise;
    signals.emit('SIGTERM');
    const exit = server.close().then(() => events.push('process exits'));
    await eventually(async () => {
      await expect(fetch(`${server.address}/healthz`)).rejects.toThrow();
    });
    await Promise.race([exit, sleep(1500)]);
    expect(events).toEqual([]);
    expect(await statesOf(w, 'sync-installation')).toEqual(['active']);
    release.resolve(undefined);
    await exit;
    expect(events).toEqual(['job finished', 'process exits']);
    expect(await statesOf(w, 'sync-installation')).toEqual(['completed']);
    expect(await w.processedAt(DELIVERY)).toBeInstanceOf(Date);
    expect(signals.exitCode).toBeUndefined();
  },
);

realPostgresRolesOnly(
  'a job stuck past the grace period is aborted, the exit code is 1, and it runs exactly once after a restart',
  async () => {
    const w = await world();
    const started = Promise.withResolvers<undefined>();
    const { server, signals, logs } = await bootServer(
      syncRegistry(
        (_job, { signal }) =>
          new Promise<never>((_resolve, reject) => {
            started.resolve(undefined);
            signal.addEventListener(
              'abort',
              () => {
                reject(new Error('aborted at the deadline'));
              },
              { once: true },
            );
          }),
      ),
    );
    await w.deliveries.record(SUBJECT, SYNC);
    await started.promise;
    signals.emit('SIGTERM');
    await server.close();
    expect(signals.exitCode).toBe(1);
    expect(logs.lines().filter((line) => line['level'] === 50)).toMatchObject([
      { msg: 'jobs still running at the end of the grace period were aborted, and run again after a restart' },
    ]);
    expect(await statesOf(w, 'sync-installation')).toEqual(['retry']);
    expect(await w.processedAt(DELIVERY)).toBeNull();
    await w.fastForward('sync-installation');
    const runs: string[] = [];
    await startWorkers(
      w,
      syncRegistry((job) => {
        runs.push(job.deliveryId ?? 'no delivery');
        return Promise.resolve(DONE);
      }),
    );
    await eventually(async () => {
      expect(await statesOf(w, 'sync-installation')).toEqual(['completed']);
    });
    expect(runs).toEqual([DELIVERY]);
    expect((await w.jobs('sync-installation')).map((job) => job.retry_count)).toEqual([1]);
    expect(await w.processedAt(DELIVERY)).toBeInstanceOf(Date);
  },
);

realPostgresRolesOnly('a handler that rejects fails its job and the process goes on with the next one', async () => {
  const w = await world();
  const unhandled: unknown[] = [];
  const noteUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', noteUnhandled);
  onTestFinished(() => {
    process.off('unhandledRejection', noteUnhandled);
  });
  const attempts: number[] = [];
  await w.enqueue(sync(32_001), 'bad');
  await w.enqueue(sync(32_002), 'good');
  await startWorkers(
    w,
    syncRegistry(async (job, { attempt }) => {
      if (job.githubInstallationId === 32_001) {
        attempts.push(attempt);
        await Promise.reject(new Error('the handler rejected'));
      }
      return DONE;
    }),
  );
  await eventually(async () => {
    expect(new Set(await statesOf(w, 'sync-installation'))).toEqual(new Set(['retry', 'completed']));
  });
  const [bad, good] = await w.jobs('sync-installation');
  expect(bad).toMatchObject({ state: 'retry', retry_count: 0, output: { message: 'the handler rejected' } });
  expect(good).toMatchObject({ state: 'completed' });
  expect(attempts).toEqual([0]);
  // The retry comes after the backoff of the queue (E07-S05); once that time has passed it runs again, and the process is still up.
  await w.fastForward('sync-installation');
  await eventually(() => {
    expect(attempts).toEqual([0, 1]);
  });
  expect(unhandled).toEqual([]);
});

realPostgresRolesOnly('the concurrency is a cap: six waiting jobs run three at a time', async () => {
  const w = await world();
  for (let n = 0; n < 6; n += 1) {
    await w.enqueue(sync(32_100 + n), `job-${n}`);
  }
  let running = 0;
  let peak = 0;
  await startWorkers(
    w,
    syncRegistry(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await sleep(1000);
      running -= 1;
      return DONE;
    }),
    { concurrency: 3 },
  );
  await eventually(async () => {
    expect(await statesOf(w, 'sync-installation')).toEqual(Array.from({ length: 6 }, () => 'completed'));
  });
  expect(peak).toBe(3);
});

realPostgresRolesOnly(
  'a payload that fails its schema is rejected without a retry, never reaches the handler and leaves its delivery open',
  async () => {
    const w = await world();
    await w.db
      .insertInto('webhook_deliveries')
      .values({ delivery_id: DELIVERY, event: 'installation', action: 'created' })
      .execute();
    const data = { type: 'sync-installation', githubInstallationId: -1, deliveryId: DELIVERY };
    await w.sendRaw('sync-installation', data);
    const handler = vi.fn<JobHandler<'sync-installation'>>(() => Promise.resolve(DONE));
    await startWorkers(w, syncRegistry(handler));
    await eventually(async () => {
      expect(await statesOf(w, 'sync-installation')).toEqual(['completed']);
    });
    const [row] = await w.jobs('sync-installation');
    expect(row).toMatchObject({ retry_count: 0, output: { rejected: 'invalid_payload' } });
    // The copy waits in the dead-letter queue, which these tests do not work (dead-letter-real.test.ts does).
    expect(await w.jobs('job-dead-letter')).toMatchObject([{ state: 'created', data }]);
    expect(handler).not.toHaveBeenCalled();
    expect(await w.processedAt(DELIVERY)).toBeNull();
  },
);

realPostgresRolesOnly('a job type with no handler keeps its jobs while the others are worked', async () => {
  const w = await world();
  await w.enqueue({ type: 'revoke-user-sessions', githubUserId: parseGithubId(77) }, 'revoke');
  await w.enqueue(sync(32_001), 'sync');
  await startWorkers(
    w,
    syncRegistry(() => Promise.resolve(DONE)),
  );
  await eventually(async () => {
    expect(await statesOf(w, 'sync-installation')).toEqual(['completed']);
  });
  expect(await statesOf(w, 'revoke-user-sessions')).toEqual(['created']);
});

realPostgresRolesOnly('the queue is not ready once a queue of the application is gone from the database', async () => {
  const w = await world();
  const queue = await startWorkers(
    w,
    syncRegistry(() => Promise.resolve(DONE)),
  );
  expect(await queue.isReady()).toBe(true);
  await w.dropQueue('sweep');
  expect(await queue.isReady()).toBe(false);
});
