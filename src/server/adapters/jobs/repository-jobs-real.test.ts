// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { setTimeout as sleep } from 'node:timers/promises';
import { type Kysely, sql } from 'kysely';
import { PgBoss } from 'pg-boss';
import { pino } from 'pino';
import { expect, inject, onTestFinished, test, vi } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { evaluatePullRequest } from '../../domain/evaluation/index.ts';
import { jobEnvelopeSchema } from '../../domain/job-envelope.ts';
import type { SweepRepositoryReason } from '../../domain/repository-jobs.ts';
import { FakeReporter, githubWorld } from '../../services/evaluate-pr/test-support.ts';
import { registerHandlers } from '../../services/job-handlers.ts';
import { HandlerRegistry } from '../../services/job-registry.ts';
import { createOrgMembership } from '../../services/org-membership.ts';
import { createOrgMembershipCache } from '../../services/org-membership-cache.ts';
import { systemClock } from '../../services/ports/clock.ts';
import type { JobQueue } from '../../services/ports/jobs.ts';
import {
  enqueueFinaliseCheck,
  enqueueFinaliseRepository,
  enqueueSweepRepository,
} from '../../services/repository-job-enqueue.ts';
import { createPgDatabase } from '../db/pg.ts';
import type { Database } from '../db/schema.ts';
import {
  migratedRuntimeDatabase,
  realPostgresRolesOnly,
  requireTestDatabaseUrl,
  seedTenant,
} from '../db/test-support.ts';
import { runtimeBossOptions } from './boss.ts';
import { migrateJobQueues } from './migrate-queues.ts';
import { startJobQueue } from './runtime.ts';

// The repository-level jobs on a real PostgreSQL (E07-S09): their queues come from the migrate step with their policies, the
// coalescing of `sweep-repository` drops a second send for one repository only while the first waits for a worker, the finalisations of one
// pull request (and of one repository) never overlap while others run in parallel, a job type with no handler keeps its jobs,
// and a change of policy over the real queue ends in one evaluation of the open pull request. It needs real connections and the
// runtime role, so it runs in the CI `postgres` job and skips on PGlite; the code it goes through is covered by the unit tests.

vi.setConfig({ testTimeout: 120_000 });

const SILENT = pino({ level: 'silent' });
const POLL_SECONDS = 0.5;
const INSTALLATION = parseGithubId(5000);
const REPOSITORY = parseGithubId(9000);

const ownerUrl = (): string => requireTestDatabaseUrl(inject('testDatabaseUrl'));

/** The test database's URL, with every session switched to the runtime role as it connects. */
function runtimeUrl(): string {
  const url = new URL(ownerUrl());
  url.searchParams.set('options', '-c role=cla_app');
  return url.href;
}

/** A fresh pgboss schema made by the migrate step, and a tenant (installation 5000, repository 9000, enforcement on). */
async function scene() {
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
  const errors: Error[] = [];
  const db = createPgDatabase({ connectionString: runtimeUrl(), onError: (error) => errors.push(error) });
  const raw = new PgBoss(runtimeBossOptions(runtimeUrl()));
  raw.on('error', (error) => errors.push(error));
  await raw.start();
  onTestFinished(async () => {
    await raw.stop({ graceful: true, timeout: 10_000 });
    await db.destroy();
    expect(errors).toEqual([]);
  });
  return {
    owner,
    db,
    raw,
    /** The queue of the application, as the runtime role starts it, with workers over `registry` when there is one. */
    start: async (registry?: HandlerRegistry): Promise<JobQueue> => {
      const queue = await startJobQueue({
        connectionString: runtimeUrl(),
        logger: SILENT,
        ...(registry === undefined
          ? {}
          : {
              workers: {
                registry,
                markDeliveryProcessed: () => Promise.resolve(),
                clock: systemClock,
                concurrency: 4,
                pollingIntervalSeconds: POLL_SECONDS,
              },
            }),
      });
      onTestFinished(async () => {
        await queue.stop();
      });
      return queue;
    },
  };
}

type Scene = Awaited<ReturnType<typeof scene>>;

interface JobRow {
  readonly state: string;
  readonly data: Record<string, unknown>;
  readonly singleton_key: string | null;
}

const jobsOf = async (owner: Kysely<Database>, queue: string): Promise<JobRow[]> =>
  (
    await sql<JobRow>`
      select state, data, singleton_key from pgboss.job where name = ${queue} order by created_on, id`.execute(owner)
  ).rows;

const statesOf = async (owner: Kysely<Database>, queue: string) => (await jobsOf(owner, queue)).map((job) => job.state);

const eventually = (check: () => Promise<void> | void): Promise<void> =>
  vi.waitFor(check, { timeout: 60_000, interval: 200 });

const sweepRepository = (
  world: Scene,
  queue: JobQueue,
  change: { readonly idempotencyKey: string; readonly reason: SweepRepositoryReason; readonly githubRepoId?: number },
) =>
  world.db.transaction().execute((tx) =>
    enqueueSweepRepository(tx, queue.enqueuer, {
      githubInstallationId: INSTALLATION,
      githubRepoId: parseGithubId(change.githubRepoId ?? REPOSITORY),
      idempotencyKey: change.idempotencyKey,
      reason: change.reason,
    }),
  );

realPostgresRolesOnly(
  'the migrate step creates the three queues with their policies, the bounds of the others and job-dead-letter as their dead-letter queue, and the runtime role starts with them',
  async () => {
    const world = await scene();
    const { rows } = await sql<{ name: string; policy: string; dead_letter: string | null; expire_seconds: number }>`
      select name, policy, dead_letter, expire_seconds from pgboss.queue
      where name in ('sweep-repository', 'finalise-repository', 'finalise-check') order by name`.execute(world.owner);
    expect(rows).toEqual([
      { name: 'finalise-check', policy: 'singleton', dead_letter: 'job-dead-letter', expire_seconds: 300 },
      { name: 'finalise-repository', policy: 'singleton', dead_letter: 'job-dead-letter', expire_seconds: 300 },
      { name: 'sweep-repository', policy: 'standard', dead_letter: 'job-dead-letter', expire_seconds: 300 },
    ]);
    const queue = await world.start();
    expect(await queue.isReady()).toBe(true);
  },
);

/** A worker takes every job of `queue` that waits, and returns their ids: they are `active` now. */
async function take(world: Scene, queue: string): Promise<string[]> {
  const jobs = await world.raw.fetch(queue, { batchSize: 10 });
  return jobs.map((job) => job.id);
}

realPostgresRolesOnly(
  'a second sweep-repository for one repository is dropped while the first waits, whatever its reason, and is sent once that one runs or is done: the run may have read the policy before the change',
  async () => {
    const world = await scene();
    const queue = await world.start();
    expect(await sweepRepository(world, queue, { idempotencyKey: 'a', reason: 'allowlist_changed' })).toBe('queued');
    expect(await sweepRepository(world, queue, { idempotencyKey: 'b', reason: 'override_changed' })).toBe(
      'deduplicated',
    );
    expect(
      await sweepRepository(world, queue, { idempotencyKey: 'c', reason: 'override_changed', githubRepoId: 9001 }),
    ).toBe('queued');
    expect(
      (await jobsOf(world.owner, 'sweep-repository')).map((job) => [job.singleton_key, job.data['reason']]),
    ).toEqual([
      ['sweep-repository:9000', 'allowlist_changed'],
      ['sweep-repository:9001', 'override_changed'],
    ]);
    expect(await sweepRepository(world, queue, { idempotencyKey: 'a', reason: 'allowlist_changed' })).toBe(
      'already_queued',
    );
    // Both runs started: a change now is not covered by them, so it gets a run of its own, and only one while that waits.
    const started = await take(world, 'sweep-repository');
    expect(started).toHaveLength(2);
    expect(await sweepRepository(world, queue, { idempotencyKey: 'd', reason: 'signature_revoked' })).toBe('queued');
    expect(await sweepRepository(world, queue, { idempotencyKey: 'e', reason: 'signature_revoked' })).toBe(
      'deduplicated',
    );
    await world.raw.complete('sweep-repository', started);
    expect(await statesOf(world.owner, 'sweep-repository')).toEqual(['completed', 'completed', 'created']);
    // The first run is over for good: the next change is covered by the run that waits, and after that one a new run.
    await world.raw.complete('sweep-repository', await take(world, 'sweep-repository'));
    expect(await sweepRepository(world, queue, { idempotencyKey: 'f', reason: 'signature_revoked' })).toBe('queued');
    expect(await statesOf(world.owner, 'sweep-repository')).toEqual(['completed', 'completed', 'completed', 'created']);
  },
);

/** Holds each job for `holdMs` and records which keys ran at once, for a worker over one of the queues. */
function recorder(holdMs: number, keyOf: (data: object) => string) {
  const running = new Map<string, number>();
  let peakPerKey = 0;
  let peakKeys = 0;
  const finished: string[] = [];
  return {
    finished,
    peakPerKey: () => peakPerKey,
    peakKeys: () => peakKeys,
    handler: async (jobs: readonly { readonly data: object }[]): Promise<void> => {
      for (const { data } of jobs) {
        const key = keyOf(data);
        running.set(key, (running.get(key) ?? 0) + 1);
        peakPerKey = Math.max(peakPerKey, running.get(key) ?? 0);
        peakKeys = Math.max(peakKeys, [...running.values()].filter((count) => count > 0).length);
        await sleep(holdMs);
        running.set(key, (running.get(key) ?? 1) - 1);
        finished.push(key);
      }
    },
  };
}

test('the recorder sees two jobs of one key at once and two keys at once, and nothing when they follow one another', async () => {
  const job = (key: string) => ({ data: { key } });
  const keyOf = (data: object): string => ('key' in data && typeof data.key === 'string' ? data.key : '');
  const overlapping = recorder(5, keyOf);
  await Promise.all([
    overlapping.handler([job('a')]),
    overlapping.handler([job('a')]),
    overlapping.handler([job('b')]),
  ]);
  expect(overlapping.peakPerKey()).toBe(2);
  expect(overlapping.peakKeys()).toBe(2);
  const following = recorder(5, keyOf);
  await following.handler([job('a'), job('b')]);
  await following.handler([job('a')]);
  expect(following.peakPerKey()).toBe(1);
  expect(following.peakKeys()).toBe(1);
  expect(following.finished).toEqual(['a', 'b', 'a']);
});

const work = { localConcurrency: 6, batchSize: 1, pollingIntervalSeconds: POLL_SECONDS } as const;

realPostgresRolesOnly(
  'two finalisations of one pull request never overlap, finalisations of other pull requests run in parallel, and none is lost',
  async () => {
    const world = await scene();
    const queue = await world.start();
    const sends = [7, 7, 7, 7, 8, 8, 8, 9].map((prNumber, index) =>
      world.db.transaction().execute((tx) =>
        enqueueFinaliseCheck(tx, queue.enqueuer, {
          githubInstallationId: INSTALLATION,
          githubRepoId: REPOSITORY,
          prNumber,
          idempotencyKey: `finalise-${prNumber}-${index}`,
        }),
      ),
    );
    expect(await Promise.all(sends)).toEqual(Array.from({ length: 8 }, () => 'queued'));
    expect(
      (await jobsOf(world.owner, 'finalise-check'))
        .map((job) => job.singleton_key)
        .toSorted((a, b) => (a ?? '').localeCompare(b ?? '')),
    ).toEqual(['9000:7', '9000:7', '9000:7', '9000:7', '9000:8', '9000:8', '9000:8', '9000:9']);
    const seen = recorder(400, (data) => {
      const job = jobEnvelopeSchema.parse(data);
      return job.type === 'finalise-check' ? `${job.githubRepoId}:${job.prNumber}` : 'other';
    });
    await world.raw.work('finalise-check', work, seen.handler);
    await eventually(async () => {
      expect(await statesOf(world.owner, 'finalise-check')).toEqual(Array.from({ length: 8 }, () => 'completed'));
    });
    expect(seen.finished).toHaveLength(8);
    expect(seen.peakPerKey()).toBe(1);
    expect(seen.peakKeys()).toBeGreaterThanOrEqual(2);
  },
);

realPostgresRolesOnly(
  'two finalisations of one repository never overlap, and those of other repositories run in parallel',
  async () => {
    const world = await scene();
    const queue = await world.start();
    for (const [index, githubRepoId] of [9000, 9000, 9000, 9001, 9001, 9002].entries()) {
      await world.db.transaction().execute((tx) =>
        enqueueFinaliseRepository(tx, queue.enqueuer, {
          githubInstallationId: INSTALLATION,
          githubRepoId: parseGithubId(githubRepoId),
          idempotencyKey: `disable-${githubRepoId}-${index}`,
        }),
      );
    }
    expect((await jobsOf(world.owner, 'finalise-repository')).map((job) => job.singleton_key)).toEqual([
      '9000',
      '9000',
      '9000',
      '9001',
      '9001',
      '9002',
    ]);
    const seen = recorder(400, (data) => {
      const job = jobEnvelopeSchema.parse(data);
      return job.type === 'finalise-repository' ? String(job.githubRepoId) : 'other';
    });
    await world.raw.work('finalise-repository', work, seen.handler);
    await eventually(async () => {
      expect(await statesOf(world.owner, 'finalise-repository')).toEqual(Array.from({ length: 6 }, () => 'completed'));
    });
    expect(seen.peakPerKey()).toBe(1);
    expect(seen.peakKeys()).toBeGreaterThanOrEqual(2);
  },
);

realPostgresRolesOnly(
  'a policy only holds within one queue: a finalise-check starts while an evaluate-pr of the same pull request is running (found in E07-S02)',
  async () => {
    const world = await scene();
    const queue = await world.start();
    await world.db.transaction().execute(async (tx) => {
      await queue.enqueuer.enqueue(
        tx,
        {
          type: 'evaluate-pr',
          githubInstallationId: INSTALLATION,
          githubRepoId: REPOSITORY,
          prNumber: 7,
          trigger: 'policy_change',
        },
        { idempotencyKey: 'evaluation' },
      );
      await enqueueFinaliseCheck(tx, queue.enqueuer, {
        githubInstallationId: INSTALLATION,
        githubRepoId: REPOSITORY,
        prNumber: 7,
        idempotencyKey: 'finalisation',
      });
    });
    const release = Promise.withResolvers<undefined>();
    const started: string[] = [];
    await world.raw.work('evaluate-pr', work, async () => {
      started.push('evaluate-pr');
      await release.promise;
    });
    await world.raw.work('finalise-check', work, () => {
      started.push('finalise-check');
      return Promise.resolve();
    });
    await eventually(() => {
      expect(started.toSorted((a, b) => a.localeCompare(b))).toEqual(['evaluate-pr', 'finalise-check']);
    });
    expect(await statesOf(world.owner, 'evaluate-pr')).toEqual(['active']);
    release.resolve(undefined);
  },
);

/** The handlers of the application over the real database, and a GitHub that has pull request 7 open and never saw a webhook for it. */
function policyRegistry(db: Kysely<Database>, reporter: FakeReporter): HandlerRegistry {
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
  });
  return registry;
}

realPostgresRolesOnly(
  'the handlers of the application work all three repository queues: the finalise jobs of a repository that enforces end as skipped, not left waiting (E14-S04)',
  async () => {
    const world = await scene();
    const reporter = new FakeReporter();
    const registry = policyRegistry(world.db, reporter);
    expect(registry.types()).toEqual(expect.arrayContaining(['finalise-repository', 'finalise-check']));
    const queue = await world.start(registry);
    await enqueueAll(world, queue);
    await eventually(async () => {
      expect(await statesOf(world.owner, 'sweep-repository')).toEqual(['completed']);
    });
    await eventually(async () => {
      expect(await statesOf(world.owner, 'evaluate-pr')).toEqual(['completed']);
    });
    await eventually(async () => {
      expect(await statesOf(world.owner, 'finalise-repository')).toEqual(['completed']);
    });
    await eventually(async () => {
      expect(await statesOf(world.owner, 'finalise-check')).toEqual(['completed']);
    });
    expect(reporter.disabled).toEqual([]);
  },
);

async function enqueueAll(world: Scene, queue: JobQueue): Promise<void> {
  await world.db.transaction().execute(async (tx) => {
    await enqueueSweepRepository(tx, queue.enqueuer, {
      githubInstallationId: INSTALLATION,
      githubRepoId: REPOSITORY,
      idempotencyKey: 'change-1',
      reason: 'repository_enabled',
    });
    await enqueueFinaliseRepository(tx, queue.enqueuer, {
      githubInstallationId: INSTALLATION,
      githubRepoId: REPOSITORY,
      idempotencyKey: 'disable-1',
    });
    await enqueueFinaliseCheck(tx, queue.enqueuer, {
      githubInstallationId: INSTALLATION,
      githubRepoId: REPOSITORY,
      prNumber: 7,
      idempotencyKey: 'finalise-7',
    });
  });
}

realPostgresRolesOnly(
  'a change of policy over the real queue ends in one evaluation of the open pull request with the trigger policy_change, and rapid edits collapse into one run',
  async () => {
    const world = await scene();
    const reporter = new FakeReporter();
    const queue = await world.start(policyRegistry(world.db, reporter));
    // Both edits are made in one transaction, so no worker can take the first before the second is sent.
    const outcomes = await world.db.transaction().execute(async (tx) => {
      const send = (idempotencyKey: string, reason: SweepRepositoryReason) =>
        enqueueSweepRepository(tx, queue.enqueuer, {
          githubInstallationId: INSTALLATION,
          githubRepoId: REPOSITORY,
          idempotencyKey,
          reason,
        });
      return [await send('a', 'cla_version_published'), await send('b', 'allowlist_changed')];
    });
    expect(outcomes).toEqual(['queued', 'deduplicated']);
    await eventually(async () => {
      expect(await statesOf(world.owner, 'evaluate-pr')).toEqual(['completed']);
    });
    expect(await jobsOf(world.owner, 'sweep-repository')).toHaveLength(1);
    expect((await jobsOf(world.owner, 'evaluate-pr')).map((job) => [job.singleton_key, job.data['trigger']])).toEqual([
      ['9000:7', 'policy_change'],
    ]);
    expect(reporter.published).toHaveLength(1);
  },
);
