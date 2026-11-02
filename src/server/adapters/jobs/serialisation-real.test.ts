// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { setTimeout as sleep } from 'node:timers/promises';
import { type Kysely, sql } from 'kysely';
import { PgBoss } from 'pg-boss';
import { pino } from 'pino';
import { expect, inject, onTestFinished, test, vi } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import type { Job } from '../../domain/jobs.ts';
import { createPgDatabase } from '../db/pg.ts';
import type { Database } from '../db/schema.ts';
import { migratedRuntimeDatabase, realPostgresRolesOnly, requireTestDatabaseUrl } from '../db/test-support.ts';
import { ownerBossOptions, runtimeBossOptions } from './boss.ts';
import { migrateJobQueues } from './migrate-queues.ts';
import { startJobQueue } from './runtime.ts';

// The serialisation policy of `evaluate-pr` (E07-S02), decided on a real PostgreSQL: at most one evaluation runs per
// (repository, pull request) at any time (P1), different pull requests run in parallel up to the concurrency (P3), a
// worker that dies mid-run does not block its key for ever (P4), and what the other policies of the pg-boss documentation
// do with a second send. P2 (no send is lost) is in serialisation-interleavings.test.ts. Candidates, in the order of the
// story: `singleton` with a `singletonKey` passes all four properties, so it is the policy; `key_strict_fifo` and the rest
// were not needed. Measured while deciding, pg-boss 12.38.0: a work queue with `groupConcurrency: 1` on a group id (the
// third candidate) ran up to 3 jobs of one group at once, because two workers that fetch at the same moment both see
// no active job of the group; only the unique index of the `singleton` policy closes that race.
//
// These need real connections and the runtime role, so they run in the CI `postgres` job and skip on PGlite. PGlite has
// one connection, so it cannot show any of this. The sends go through the `PgBossEnqueuer` of the application, the
// workers are pg-boss's own, started as the runtime role, and the queues come from the migrate step.

vi.setConfig({ testTimeout: 180_000 });

const SILENT = pino({ level: 'silent' });
const INSTALLATION = parseGithubId(32_001);
/** How often a worker looks for a job: the shortest interval pg-boss accepts. */
const POLL_SECONDS = 0.5;

const ownerUrl = (): string => requireTestDatabaseUrl(inject('testDatabaseUrl'));

/** The test database's URL, with every session switched to the runtime role as it connects. */
function runtimeUrl(): string {
  const url = new URL(ownerUrl());
  url.searchParams.set('options', '-c role=cla_app');
  return url.href;
}

/** `evaluate-pr` of pull request `prNumber` of repository `repo`. */
function evaluation(repo: number, prNumber: number, sequence: number): Job {
  return {
    type: 'evaluate-pr',
    githubInstallationId: INSTALLATION,
    githubRepoId: parseGithubId(repo),
    prNumber,
    trigger: sequence === 0 ? 'pull_request' : 'sweep',
  };
}

interface World {
  readonly owner: Kysely<Database>;
  /** The connection of the application: the runtime role. */
  readonly db: Kysely<Database>;
  /** pg-boss as the application starts it, for workers and for fetching by hand. */
  readonly boss: PgBoss;
  /** Sends `job` in a transaction of its own that commits, through the enqueuer of the application. */
  readonly send: (job: Job, idempotencyKey: string) => Promise<string>;
}

/**
 * A fresh pgboss schema made by the migrate step, the application's queue and pg-boss as the runtime role; all stopped
 * after the test. `monitorSeconds` shortens the interval between two maintenance passes over a queue (60 s by default),
 * which is what a test that calls `supervise` twice needs.
 */
async function world(monitorSeconds?: number): Promise<World> {
  const { db: owner } = await migratedRuntimeDatabase();
  await sql`drop schema if exists pgboss cascade`.execute(owner);
  const errors: Error[] = [];
  await migrateJobQueues({ connectionString: ownerUrl(), db: owner, onError: (error) => errors.push(error) });
  const queue = await startJobQueue({ connectionString: runtimeUrl(), logger: SILENT });
  const db = createPgDatabase({ connectionString: runtimeUrl(), onError: (error) => errors.push(error) });
  const boss = new PgBoss({
    ...runtimeBossOptions(runtimeUrl()),
    ...(monitorSeconds === undefined ? {} : { monitorIntervalSeconds: monitorSeconds }),
  });
  boss.on('error', (error) => errors.push(error));
  await boss.start();
  onTestFinished(async () => {
    await boss.stop({ graceful: true, timeout: 10_000 });
    await queue.stop();
    await db.destroy();
    expect(errors).toEqual([]);
  });
  return {
    owner,
    db,
    boss,
    send: (job, idempotencyKey) =>
      db.transaction().execute((tx) => queue.enqueuer.enqueue(tx, job, { idempotencyKey })),
  };
}

async function liveJobs(owner: Kysely<Database>, queue = 'evaluate-pr'): Promise<number> {
  const { rows } = await sql<{ n: number }>`
    select count(*)::int as n from pgboss.job where name = ${queue} and state in ('created', 'retry', 'active')`.execute(
    owner,
  );
  return rows[0]?.n ?? 0;
}

/** Waits until the queue holds no job that is going to run. */
function drained(owner: Kysely<Database>): Promise<void> {
  return vi.waitFor(
    async () => {
      expect(await liveJobs(owner)).toBe(0);
    },
    { timeout: 150_000, interval: 250 },
  );
}

/**
 * The handler of a worker that records what ran at the same time, and holds each job for `holdMs` so that a second one
 * of the same key would overlap it if the queue allowed it.
 */
function recorder(holdMs: number) {
  const running = new Map<string, number>();
  const peakPerKey = new Map<string, number>();
  const started: string[] = [];
  let peakKeys = 0;
  return {
    started,
    peakKeys: () => peakKeys,
    peakPerKey: () => Math.max(0, ...peakPerKey.values()),
    handler: async (jobs: readonly { readonly data: Job }[]): Promise<void> => {
      for (const { data } of jobs) {
        const key = data.type === 'evaluate-pr' ? `${data.githubRepoId}:${data.prNumber}` : 'other';
        const now = (running.get(key) ?? 0) + 1;
        running.set(key, now);
        peakPerKey.set(key, Math.max(peakPerKey.get(key) ?? 0, now));
        peakKeys = Math.max(peakKeys, [...running.values()].filter((count) => count > 0).length);
        started.push(key);
        await sleep(holdMs);
        running.set(key, now - 1);
      }
    },
  };
}

test('the recorder sees two jobs of one key at once and two keys at once, and nothing when they follow one another', async () => {
  const job = (prNumber: number) => ({ data: evaluation(9001, prNumber, 0) });
  const overlapping = recorder(5);
  await Promise.all([overlapping.handler([job(7)]), overlapping.handler([job(7)]), overlapping.handler([job(8)])]);
  expect(overlapping.peakPerKey()).toBe(2);
  expect(overlapping.peakKeys()).toBe(2);
  const following = recorder(5);
  await following.handler([job(7), job(8)]);
  await following.handler([job(7)]);
  expect(following.peakPerKey()).toBe(1);
  expect(following.peakKeys()).toBe(1);
  expect(following.started).toEqual(['9001:7', '9001:8', '9001:7']);
});

realPostgresRolesOnly(
  'the migrate step creates evaluate-pr as a singleton queue that takes a job back after 300 seconds, and the others as standard',
  async () => {
    const { owner } = await world();
    const { rows } = await sql<{ name: string; policy: string; expire_seconds: number }>`
      select name, policy, expire_seconds from pgboss.queue order by name`.execute(owner);
    expect(rows.find((row) => row.name === 'evaluate-pr')).toEqual({
      name: 'evaluate-pr',
      policy: 'singleton',
      expire_seconds: 300,
    });
    expect(rows.filter((row) => row.policy !== 'standard').map((row) => row.name)).toEqual(['evaluate-pr']);
    expect(new Set(rows.map((row) => row.expire_seconds))).toEqual(new Set([300]));
  },
);

/** A window long enough that two sends a moment apart never meet a window boundary. */
const A_DAY = 86_400;

realPostgresRolesOnly(
  'a dedupe window on evaluate-pr is shared by the sends for one pull request, whatever their dedupe key, and not by other pull requests',
  async () => {
    const { owner, send, db } = await world();
    const queue = await startJobQueue({ connectionString: runtimeUrl(), logger: SILENT });
    onTestFinished(async () => {
      await queue.stop();
    });
    const window = (idempotencyKey: string, dedupeKey: string, pr: number) =>
      db.transaction().execute((tx) =>
        queue.enqueuer.enqueue(tx, evaluation(9001, pr, 1), {
          idempotencyKey,
          dedupeKey,
          dedupeWindowSeconds: A_DAY,
        }),
      );
    expect(await send(evaluation(9001, 7, 0), 'window-plain')).toBe('queued');
    expect(await window('window-recheck', 'recheck:9001:7', 7)).toBe('queued');
    expect(await window('window-policy', 'policy_change:9001:7', 7)).toBe('deduplicated');
    expect(await window('window-other', 'recheck:9001:8', 8)).toBe('queued');
    expect(await liveJobs(owner)).toBe(3);
    const keys = await sql<{ singleton_key: string }>`
      select singleton_key from pgboss.job where name = 'evaluate-pr' order by singleton_key`.execute(owner);
    expect(keys.rows.map((row) => row.singleton_key)).toEqual(['9001:7', '9001:7', '9001:8']);
  },
);

realPostgresRolesOnly(
  'a repeated idempotency key leaves one evaluate-pr job whatever the key of its pull request',
  async () => {
    const { owner, send } = await world();
    expect(await send(evaluation(9001, 7, 0), 'same-delivery')).toBe('queued');
    expect(await send(evaluation(9001, 7, 0), 'same-delivery')).toBe('already_queued');
    expect(await liveJobs(owner)).toBe(1);
  },
);

realPostgresRolesOnly(
  'P1: 50 sends for one pull request never run two evaluations at once, and each one runs',
  async () => {
    const { owner, boss, send } = await world();
    const seen = recorder(40);
    await boss.work<Job>('evaluate-pr', { localConcurrency: 5, pollingIntervalSeconds: POLL_SECONDS }, seen.handler);
    for (let i = 0; i < 50; i++) {
      expect(await send(evaluation(9001, 7, i), `p1-${i}`)).toBe('queued');
    }
    await drained(owner);
    expect(seen.peakPerKey()).toBe(1);
    expect(seen.started).toEqual(Array.from({ length: 50 }, () => '9001:7'));
  },
);

realPostgresRolesOnly(
  'P3: ten pull requests with five sends each run in parallel at concurrency 5, and one at a time each',
  async () => {
    const { owner, boss, send } = await world();
    const seen = recorder(250);
    await boss.work<Job>('evaluate-pr', { localConcurrency: 5, pollingIntervalSeconds: POLL_SECONDS }, seen.handler);
    for (let round = 0; round < 5; round++) {
      for (let pr = 1; pr <= 10; pr++) {
        expect(await send(evaluation(9001, pr, round), `p3-${pr}-${round}`)).toBe('queued');
      }
    }
    await drained(owner);
    expect(seen.peakKeys()).toBeGreaterThanOrEqual(2);
    expect(seen.peakKeys()).toBeLessThanOrEqual(5);
    expect(seen.peakPerKey()).toBe(1);
    expect(seen.started).toHaveLength(50);
    expect(new Set(seen.started).size).toBe(10);
  },
);

realPostgresRolesOnly(
  'two repositories with the same pull request number are two keys, and so are two pull requests of one repository',
  async () => {
    const { boss, send } = await world();
    for (const [repo, pr, sequence] of [
      [9001, 7, 0],
      [9001, 7, 1],
      [9002, 7, 0],
      [9001, 8, 0],
    ] as const) {
      await send(evaluation(repo, pr, sequence), `keys-${repo}-${pr}-${sequence}`);
    }
    const fetched = await boss.fetch<Job>('evaluate-pr', { batchSize: 10 });
    const keys = fetched.map((job) =>
      job.data.type === 'evaluate-pr' ? `${job.data.githubRepoId}:${job.data.prNumber}` : '',
    );
    expect(keys.toSorted((x, y) => x.localeCompare(y))).toEqual(['9001:7', '9001:8', '9002:7']);
  },
);

/**
 * One maintenance pass over the queue, which expires the jobs that ran too long, with every active job started `ranSeconds`
 * ago (the clock of a worker that died that long ago). pg-boss skips a queue it looked at less than a monitor interval
 * (1 s here) ago, hence the wait first.
 */
async function superviseAfter(owner: Kysely<Database>, boss: PgBoss, ranSeconds: number): Promise<void> {
  await sleep(1100);
  await sql`
    update pgboss.job set started_on = pgboss.job_now() - make_interval(secs => ${ranSeconds})
    where name = 'evaluate-pr' and state = 'active'`.execute(owner);
  await boss.supervise('evaluate-pr');
}

realPostgresRolesOnly(
  'P4: a worker that dies mid-run blocks its key only until the job expires, and then the next send runs',
  async () => {
    const { owner, boss, send } = await world(1);
    await send(evaluation(9001, 7, 0), 'p4-dead');
    // The worker takes the job and dies: nothing ever completes or fails it.
    const [dead] = await boss.fetch<Job>('evaluate-pr');
    expect(dead).toBeDefined();
    await send(evaluation(9001, 7, 1), 'p4-next');
    await send(evaluation(9001, 8, 0), 'p4-other');
    // The key is blocked while the dead job counts as running: another worker gets the other pull request only.
    const other = await boss.fetch<Job>('evaluate-pr');
    expect(other.map((job) => (job.data.type === 'evaluate-pr' ? job.data.prNumber : 0))).toEqual([8]);
    expect(await boss.fetch('evaluate-pr')).toEqual([]);
    await boss.complete(
      'evaluate-pr',
      other.map((job) => job.id),
    );
    // 299 seconds into the run it is still taken for running.
    await superviseAfter(owner, boss, 299);
    expect(await boss.fetch('evaluate-pr')).toEqual([]);
    // Past 300 seconds pg-boss takes it back, and the key runs again: the reclaimed job, then the next send.
    await superviseAfter(owner, boss, 301);
    const ran: string[] = [];
    for (let i = 0; i < 2; i++) {
      const [job] = await boss.fetch<Job>('evaluate-pr');
      expect(job).toBeDefined();
      expect(await boss.fetch('evaluate-pr')).toEqual([]);
      ran.push(`${job?.id}`);
      await boss.complete('evaluate-pr', `${job?.id}`);
    }
    expect(ran).toContain(dead?.id);
    expect(new Set(ran).size).toBe(2);
    const states = await sql<{ id: string; state: string; retry_count: number }>`
      select id, state, retry_count from pgboss.job where name = 'evaluate-pr' and id = ${dead?.id ?? ''}`.execute(
      owner,
    );
    expect(states.rows).toEqual([{ id: dead?.id, state: 'completed', retry_count: 1 }]);
  },
);

/** A pg-boss with the owner's rights, started on the schema of a fresh {@link world}, and stopped after the test. */
async function ownerBoss(): Promise<{ boss: PgBoss; owner: Kysely<Database> }> {
  const { owner } = await world();
  const errors: Error[] = [];
  const boss = new PgBoss(ownerBossOptions(ownerUrl()));
  boss.on('error', (error) => errors.push(error));
  await boss.start();
  onTestFinished(async () => {
    await boss.stop({ graceful: true, timeout: 10_000 });
    expect(errors).toEqual([]);
  });
  return { boss, owner };
}

/** A queue of the given policy of the pg-boss documentation that the application does not use. */
async function probeQueue(
  policy: 'short' | 'exclusive',
): Promise<{ name: string; boss: PgBoss; owner: Kysely<Database> }> {
  const { boss, owner } = await ownerBoss();
  const name = `probe-${policy}`;
  await boss.createQueue(name, { policy });
  return { name, boss, owner };
}

const KEY = { singletonKey: '9001:7' };

async function activeJobs(owner: Kysely<Database>, queue: string): Promise<number> {
  const { rows } = await sql<{ n: number }>`
    select count(*)::int as n from pgboss.job where name = ${queue} and state = 'active'`.execute(owner);
  return rows[0]?.n ?? 0;
}

realPostgresRolesOnly(
  'the short policy drops a second send only while the first still waits, and lets two jobs of one key run at once',
  async () => {
    const { name, boss, owner } = await probeQueue('short');
    expect(await boss.send(name, { n: 1 }, KEY)).toEqual(expect.any(String));
    expect(await boss.send(name, { n: 2 }, KEY)).toBeNull();
    expect(await boss.fetch(name)).toHaveLength(1);
    expect(await boss.send(name, { n: 3 }, KEY)).toEqual(expect.any(String));
    expect(await boss.fetch(name)).toHaveLength(1);
    expect(await activeJobs(owner, name)).toBe(2);
  },
);

realPostgresRolesOnly(
  'the exclusive policy drops a send while one is waiting and while one is running, so a send that arrives mid-run is lost',
  async () => {
    const { name, boss, owner } = await probeQueue('exclusive');
    expect(await boss.send(name, { n: 1 }, KEY)).toEqual(expect.any(String));
    expect(await boss.send(name, { n: 2 }, KEY)).toBeNull();
    expect(await boss.fetch(name)).toHaveLength(1);
    expect(await boss.send(name, { n: 3 }, KEY)).toBeNull();
    expect(await liveJobs(owner, name)).toBe(1);
    expect(await activeJobs(owner, name)).toBe(1);
  },
);

realPostgresRolesOnly(
  'an evaluate-pr queue of another policy is refused by the migrate step and by the start-up check, and nothing is changed',
  async () => {
    const { boss, owner } = await ownerBoss();
    await boss.deleteQueue('evaluate-pr');
    await boss.createQueue('evaluate-pr', { policy: 'standard' });
    const mismatch = { mismatches: [{ queue: 'evaluate-pr', found: 'standard', expected: 'singleton' }] };
    await expect(
      migrateJobQueues({ connectionString: ownerUrl(), db: owner, onError: () => undefined }),
    ).rejects.toMatchObject(mismatch);
    await expect(startJobQueue({ connectionString: runtimeUrl(), logger: SILENT })).rejects.toMatchObject(mismatch);
    const { rows } = await sql<{ policy: string }>`select policy from pgboss.queue where name = 'evaluate-pr'`.execute(
      owner,
    );
    expect(rows).toEqual([{ policy: 'standard' }]);
  },
);
