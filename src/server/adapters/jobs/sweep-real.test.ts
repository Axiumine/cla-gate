// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { PgBoss } from 'pg-boss';
import { pino } from 'pino';
import { expect, inject, onTestFinished, test, vi } from 'vitest';
import { evaluatePullRequest } from '../../domain/evaluation/index.ts';
import type { SweepInterval } from '../../domain/sweep.ts';
import { FakeReporter, githubWorld } from '../../services/evaluate-pr/test-support.ts';
import { registerHandlers } from '../../services/job-handlers.ts';
import { HandlerRegistry } from '../../services/job-registry.ts';
import { createOrgMembership } from '../../services/org-membership.ts';
import { createOrgMembershipCache } from '../../services/org-membership-cache.ts';
import { systemClock } from '../../services/ports/clock.ts';
import { captureLogs, testConfig } from '../../test-support.ts';
import { createPgDatabase } from '../db/pg.ts';
import type { Database } from '../db/schema.ts';
import {
  migratedRuntimeDatabase,
  realPostgresRolesOnly,
  requireTestDatabaseUrl,
  seedTenant,
} from '../db/test-support.ts';
import { createLogger } from '../http/logger.ts';
import { createPgBoss, runtimeBossOptions } from './boss.ts';
import { migrateJobQueues } from './migrate-queues.ts';
import { SCHEDULER_QUEUE } from './queues.ts';
import { startJobQueue } from './runtime.ts';

// The scheduled sweep on a real PostgreSQL (E07-S08): pg-boss's scheduler, started as the runtime role (it needs the DML on the
// `pgboss` schema and nothing else), puts a `sweep` job on the queue when the cron of the schedule is due; there is one sweep
// at a time; and a pull request that missed its delivery is evaluated once, by the chain `sweep`, `sweep-installation`,
// `evaluate-pr` over the real queue, and not again by the next sweep. It needs real connections and the runtime role, so it
// runs in the CI `postgres` job and skips on PGlite; the code it goes through is covered by the unit tests.

vi.setConfig({ testTimeout: 120_000 });

/** How often a worker looks for a job, and the scheduler for a schedule that is due: the shortest interval pg-boss accepts. */
const POLL_SECONDS = 0.5;
const SCHEDULER_SECONDS = 1;
const ownerUrl = (): string => requireTestDatabaseUrl(inject('testDatabaseUrl'));

/** The test database's URL, with every session switched to the runtime role as it connects. */
function runtimeUrl(): string {
  const url = new URL(ownerUrl());
  url.searchParams.set('options', '-c role=cla_app');
  return url.href;
}

/** The queue schema made by the migrate step and a tenant whose repository is enabled, as the owner sees it. */
async function migratedTenant(): Promise<Kysely<Database>> {
  const { db: owner } = await migratedRuntimeDatabase();
  await sql`drop schema if exists pgboss cascade`.execute(owner);
  await migrateJobQueues({ connectionString: ownerUrl(), db: owner, onError: () => undefined });
  const tenant = await seedTenant(owner, 1);
  await sql`update installations set admission_status = 'admitted', admission_reason = null`.execute(owner);
  await owner
    .updateTable('repositories')
    .set({ enabled: true, cla_document_id: tenant.documentId })
    .where('installation_id', '=', tenant.installationId)
    .execute();
  return owner;
}

/** The tenant, the application's database as the runtime role and a way to start its queue with workers over a registry. */
async function scene() {
  const owner = await migratedTenant();
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
    logs,
    raw,
    /** The queue of the application with its workers, the scheduler checking every second; stopped after the test unless the test stopped it. */
    start: async (registry: HandlerRegistry, sweepIntervalMinutes: SweepInterval) => {
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
          sweepIntervalMinutes,
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

/** The schedule of the reconciliation sweep; the retention sweep (E22-S04) has its own, which retention-real.test.ts checks. */
const schedules = async (owner: Kysely<Database>) =>
  (
    await sql<{
      name: string;
      cron: string;
      data: unknown;
    }>`select name, cron, data from pgboss.schedule where name = 'sweep' order by name`.execute(owner)
  ).rows;

const jobsOf = async (owner: Kysely<Database>, queue: string) =>
  (
    await sql<{ state: string; data: Record<string, unknown>; singleton_key: string | null }>`
    select state, data, singleton_key from pgboss.job where name = ${queue} order by created_on, id`.execute(owner)
  ).rows;

const eventually = (check: () => Promise<void> | void): Promise<void> =>
  vi.waitFor(check, { timeout: 60_000, interval: 200 });

/** A registry that records the `sweep` jobs it is given, and holds each until `release` is called when `hold` is set. */
function recordingRegistry(hold = false) {
  const seen: unknown[] = [];
  const released = Promise.withResolvers<undefined>();
  const registry = new HandlerRegistry();
  registry.register('sweep', async (job) => {
    seen.push(job);
    if (hold) {
      await released.promise;
    }
    return { outcome: 'fanned_out' };
  });
  return {
    registry,
    seen,
    release: () => {
      released.resolve(undefined);
    },
  };
}

test('the registry of these tests binds the sweep and nothing else, so every other queue has no consumer', () => {
  expect(recordingRegistry().registry.types()).toEqual(['sweep']);
});

realPostgresRolesOnly(
  'the migrate step makes the queue of the scheduler, and the runtime role schedules the sweep with the cron of the interval, changes it, and removes it with an interval of 0',
  async () => {
    const world: Scene = await scene();
    expect(
      (await sql<{ name: string }>`select name from pgboss.queue where name = ${SCHEDULER_QUEUE}`.execute(world.owner))
        .rows,
    ).toHaveLength(1);
    const first = await world.start(recordingRegistry().registry, 5);
    expect(await schedules(world.owner)).toEqual([{ name: 'sweep', cron: '*/5 * * * *', data: { type: 'sweep' } }]);
    await first.stop();
    const second = await world.start(recordingRegistry().registry, 30);
    expect(await schedules(world.owner)).toEqual([{ name: 'sweep', cron: '*/30 * * * *', data: { type: 'sweep' } }]);
    await second.stop();
    const third = await world.start(recordingRegistry().registry, 60);
    expect(await schedules(world.owner)).toEqual([{ name: 'sweep', cron: '0 * * * *', data: { type: 'sweep' } }]);
    await third.stop();
    await (await world.start(recordingRegistry().registry, 0)).stop();
    expect(await schedules(world.owner)).toEqual([]);
  },
);

realPostgresRolesOnly('a schedule that is due puts one sweep job on the queue, which a worker runs', async () => {
  const world = await scene();
  const { registry, seen } = recordingRegistry();
  await world.start(registry, 5);
  // the cron of the interval is not due for minutes; one that is due every minute is, at once, for the scheduler to find
  await sql`update pgboss.schedule set cron = '* * * * *' where name = 'sweep'`.execute(world.owner);
  await eventually(() => {
    expect(seen).toEqual([{ type: 'sweep' }]);
  });
  await eventually(async () => {
    expect((await jobsOf(world.owner, 'sweep')).map((job) => job.state)).toEqual(['completed']);
  });
});

realPostgresRolesOnly(
  'there is one sweep at a time: a second one is not queued while one waits or runs, and is when it is over',
  async () => {
    const world = await scene();
    expect(await world.raw.send('sweep', { type: 'sweep' })).not.toBeNull();
    expect(await world.raw.send('sweep', { type: 'sweep' })).toBeNull();
    const { registry, seen, release } = recordingRegistry(true);
    await world.start(registry, 0);
    await eventually(() => {
      expect(seen).toHaveLength(1);
    });
    expect((await jobsOf(world.owner, 'sweep')).map((job) => job.state)).toEqual(['active']);
    expect(await world.raw.send('sweep', { type: 'sweep' })).toBeNull();
    release();
    await eventually(async () => {
      expect((await jobsOf(world.owner, 'sweep')).map((job) => job.state)).toEqual(['completed']);
    });
    expect(await world.raw.send('sweep', { type: 'sweep' })).not.toBeNull();
  },
);

/** The handlers of the application over the real database and a GitHub that has pull request 7 open and never saw a webhook for it. */
function sweepingRegistry(db: Kysely<Database>, reporter: FakeReporter): HandlerRegistry {
  const github = githubWorld();
  const logger = pino({ level: 'silent' });
  const registry = new HandlerRegistry();
  registerHandlers(registry, {
    syncInstallation: undefined,
    evaluatePr: () => ({
      db,
      github,
      clock: systemClock,
      orgMembership: createOrgMembership({ db, github, logger, cache: createOrgMembershipCache(systemClock) }),
      reporter,
      evaluate: evaluatePullRequest,
    }),
    sweep: { db, reconcileInstallations: () => Promise.resolve({ synced: 1, failed: 0 }) },
  });
  return registry;
}

const states = async (owner: Kysely<Database>, queue: string) => (await jobsOf(owner, queue)).map((job) => job.state);

realPostgresRolesOnly(
  'a pull request that missed its delivery is evaluated once by a sweep, over the queue, and the next sweep queues nothing for it',
  async () => {
    const world = await scene();
    const reporter = new FakeReporter();
    await world.start(sweepingRegistry(world.db, reporter), 0);
    expect(await world.raw.send('sweep', { type: 'sweep' })).not.toBeNull();
    await eventually(async () => {
      expect(await states(world.owner, 'evaluate-pr')).toEqual(['completed']);
    });
    expect((await jobsOf(world.owner, 'evaluate-pr')).map((job) => [job.singleton_key, job.data['trigger']])).toEqual([
      ['9000:7', 'sweep'],
    ]);
    expect(await states(world.owner, 'sweep-installation')).toEqual(['completed']);
    expect(reporter.published).toHaveLength(1);
    const stored = await world.owner.selectFrom('pr_evaluations').select(['pr_number', 'result']).execute();
    expect(stored).toHaveLength(1);
    expect(['success', 'failure']).toContain(stored[0]?.result);
    // a second sweep once the job of the installation ran: a new job runs, finds the verdict and queues nothing
    expect(await world.raw.send('sweep', { type: 'sweep' })).not.toBeNull();
    await eventually(async () => {
      expect(await states(world.owner, 'sweep-installation')).toEqual(['completed', 'completed']);
    });
    expect(await states(world.owner, 'evaluate-pr')).toEqual(['completed']);
    expect(reporter.published).toHaveLength(1);
  },
);

realPostgresRolesOnly(
  'a sweep starts a sweep-installation job for the installation again once the previous one has run',
  async () => {
    const world = await scene();
    await world.start(sweepingRegistry(world.db, new FakeReporter()), 0);
    expect(await world.raw.send('sweep', { type: 'sweep' })).not.toBeNull();
    // The job of the installation has run, not only the sweep that sent it: a second sweep that finds it still waiting
    // sends nothing, because the waiting job covers it (the coalescing of E07-S08).
    await eventually(async () => {
      expect(await states(world.owner, 'sweep')).toEqual(['completed']);
      expect(await states(world.owner, 'sweep-installation')).toEqual(['completed']);
    });
    expect(await world.raw.send('sweep', { type: 'sweep' })).not.toBeNull();
    await eventually(async () => {
      expect(await states(world.owner, 'sweep')).toEqual(['completed', 'completed']);
    });
    expect(await jobsOf(world.owner, 'sweep-installation')).toHaveLength(2);
  },
);
