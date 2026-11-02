// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { PgBoss } from 'pg-boss';
import { pino } from 'pino';
import { expect, inject, onTestFinished, test, vi } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import type { Job } from '../../domain/jobs.ts';
import { createPgDatabase } from '../db/pg.ts';
import type { Database } from '../db/schema.ts';
import { migratedRuntimeDatabase, realPostgresRolesOnly, requireTestDatabaseUrl } from '../db/test-support.ts';
import { runtimeBossOptions } from './boss.ts';
import { migrateJobQueues } from './migrate-queues.ts';
import { startJobQueue } from './runtime.ts';

// Property P2 of the serialisation policy of `evaluate-pr` (E07-S02): no send is lost. After the last send for a pull
// request, at least one run for it starts after that send, whatever the order of the sends, the starts, the completions
// and the failures that led there. 200 random interleavings, each from its own seed, on a real PostgreSQL (PGlite has one
// connection), run in blocks so that no test outlives its timeout. The seed is in the message of a failure.
//
// The external state is a counter the test increments before each send, like the head of a pull request that moves
// before the delivery about it is sent. A run reads the counter when it starts, the way an evaluation reads GitHub. The
// test plays the workers itself: it fetches, completes and fails jobs by hand, so the order of every event is the one the
// seed chose and nothing depends on a timer. Fetching is the statement pg-boss's own workers use. The sends go through the
// `PgBossEnqueuer` of the application, and the queue comes from the migrate step.

vi.setConfig({ testTimeout: 180_000 });

const SEEDS = 200;
const SEEDS_PER_TEST = 25;
const INSTALLATION = parseGithubId(32_001);
/** The queue retries a failed job five times (E07-S05); a job is failed at most twice here, so it never dies. */
const FAILURES_PER_JOB = 2;

const ownerUrl = (): string => requireTestDatabaseUrl(inject('testDatabaseUrl'));

function runtimeUrl(): string {
  const url = new URL(ownerUrl());
  url.searchParams.set('options', '-c role=cla_app');
  return url.href;
}

/** mulberry32: a small seeded generator, so that a failing seed can be run again. Returns numbers in [0, 1). */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface Queue {
  readonly owner: Kysely<Database>;
  readonly boss: PgBoss;
  readonly send: (job: Job, idempotencyKey: string) => Promise<string>;
}

/** The migrate step, the application's queue and pg-boss as the runtime role, all stopped after the test. */
async function queue(): Promise<Queue> {
  const { db: owner } = await migratedRuntimeDatabase();
  await sql`drop schema if exists pgboss cascade`.execute(owner);
  const errors: Error[] = [];
  await migrateJobQueues({ connectionString: ownerUrl(), db: owner, onError: (error) => errors.push(error) });
  const running = await startJobQueue({
    connectionString: runtimeUrl(),
    logger: pino({ level: 'silent' }),
  });
  const db = createPgDatabase({ connectionString: runtimeUrl(), onError: (error) => errors.push(error) });
  const boss = new PgBoss(runtimeBossOptions(runtimeUrl()));
  boss.on('error', (error) => errors.push(error));
  await boss.start();
  onTestFinished(async () => {
    await boss.stop({ graceful: true, timeout: 10_000 });
    await running.stop();
    await db.destroy();
    expect(errors).toEqual([]);
  });
  return {
    owner,
    boss,
    send: (job, idempotencyKey) =>
      db.transaction().execute((tx) => running.enqueuer.enqueue(tx, job, { idempotencyKey })),
  };
}

/** What the test saw of one interleaving. */
interface Outcome {
  /** The counter as each run saw it when it started, in the order the runs started. */
  readonly seen: readonly number[];
  readonly counter: number;
  readonly sends: number;
  readonly failures: number;
  readonly left: number;
}

/** The jobs of `key` that wait or run now; throws unless the number that run is the one the test believes runs. */
async function liveJobs(owner: Kysely<Database>, key: string, running: number): Promise<number> {
  const { rows } = await sql<{ queued: number; active: number }>`
    select count(*) filter (where state in ('created', 'retry'))::int as queued,
           count(*) filter (where state = 'active')::int as active
    from pgboss.job where name = 'evaluate-pr' and singleton_key = ${key}`.execute(owner);
  expect(rows[0]?.active).toBe(running);
  return (rows[0]?.queued ?? 0) + (rows[0]?.active ?? 0);
}

/** The retry of a failed job waits for its backoff (30 s or more, E07-S05): the test is the clock, and lets that time pass. */
async function retryNow(owner: Kysely<Database>, id: string): Promise<void> {
  await sql`update pgboss.job set start_after = now() where name = 'evaluate-pr' and id = ${id} and state = 'retry'`.execute(
    owner,
  );
}

/** The events of one interleaving, each a call: the sends, the starts of runs, and the ends of runs, and what they leave behind. */
function createRun(world: Queue, seed: number) {
  const random = seededRandom(seed);
  const job: Job = {
    type: 'evaluate-pr',
    githubInstallationId: INSTALLATION,
    githubRepoId: parseGithubId(10_000 + seed),
    prNumber: 7,
    trigger: 'pull_request',
  };
  let counter = 0;
  let sends = 0;
  let failures = 0;
  const seen: number[] = [];
  const running: string[] = [];
  const failed = new Map<string, number>();
  return {
    random,
    running: () => running.length,
    live: () => liveJobs(world.owner, `${10_000 + seed}:7`, running.length),
    outcome: () => ({ seen, counter, sends, failures }),
    send: async (): Promise<void> => {
      counter += 1;
      sends += 1;
      await world.send(job, `seed-${seed}-send-${sends}`);
    },
    start: async (): Promise<void> => {
      const fetched = await world.boss.fetch<Job>('evaluate-pr', { batchSize: 1 + Math.floor(random() * 3) });
      for (const { id } of fetched) {
        seen.push(counter);
        running.push(id);
      }
    },
    settle: async (mayFail: boolean): Promise<void> => {
      const [id] = running.splice(Math.floor(random() * running.length), 1);
      if (id === undefined) {
        return;
      }
      if (mayFail && (failed.get(id) ?? 0) < FAILURES_PER_JOB) {
        failed.set(id, (failed.get(id) ?? 0) + 1);
        failures += 1;
        await world.boss.fail('evaluate-pr', id);
        await retryNow(world.owner, id);
      } else {
        await world.boss.complete('evaluate-pr', id);
      }
    },
  };
}

/**
 * One interleaving of sends, starts, completions and failures for the pull request `seed` of the repository `10000 + seed`,
 * every pull request of its own so that the interleavings of one test do not meet. Throws as soon as two runs of the key
 * overlap, in the test's books or in the database's.
 */
async function interleave(world: Queue, seed: number): Promise<Outcome> {
  const run = createRun(world, seed);
  const steps = 6 + Math.floor(run.random() * 20);
  for (let step = 0; step < steps; step++) {
    const roll = run.random();
    if (step === 0 || roll < 0.4) {
      await run.send();
    } else if (roll < 0.7) {
      await run.start();
    } else {
      await run.settle(roll >= 0.9);
    }
    // P1 at every step: the one run there is, or none.
    expect(run.running()).toBeLessThanOrEqual(1);
    await run.live();
  }
  // The rest of the work: the workers go on until the queue is empty. Each pass ends what runs and starts what is next.
  const { sends } = run.outcome();
  for (let pass = 0; pass < 4 * sends + 8 && ((await run.live()) > 0 || run.running() > 0); pass++) {
    await run.settle(false);
    await run.start();
    expect(run.running()).toBeLessThanOrEqual(1);
  }
  return { ...run.outcome(), left: await run.live() };
}

/** Runs the interleavings of `seeds`; a failure names its seed. */
async function interleavings(seeds: readonly number[]): Promise<void> {
  const world = await queue();
  for (const seed of seeds) {
    try {
      const outcome = await interleave(world, seed);
      expect(outcome.left, 'jobs left in the queue').toBe(0);
      expect(outcome.seen.at(-1), 'the counter the last run saw').toBe(outcome.counter);
      expect(outcome.seen.length, 'one run per send, and one more per failure').toBe(outcome.sends + outcome.failures);
    } catch (error) {
      throw new Error(
        `interleaving of seed ${seed} failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error,
        },
      );
    }
  }
}

for (let first = 0; first < SEEDS; first += SEEDS_PER_TEST) {
  const seeds = Array.from({ length: SEEDS_PER_TEST }, (_unused, offset) => first + offset);
  realPostgresRolesOnly(
    `P2: no send is lost in ${SEEDS_PER_TEST} random interleavings of sends, starts, completions and failures (seeds ${first} to ${first + SEEDS_PER_TEST - 1})`,
    () => interleavings(seeds),
  );
}

test('the generator of the seeds gives numbers in [0, 1), the same ones for the same seed and other ones for another', () => {
  const draw = (seed: number): number[] => {
    const random = seededRandom(seed);
    return Array.from({ length: 5 }, () => random());
  };
  expect(draw(7)).toEqual(draw(7));
  expect(draw(7)).not.toEqual(draw(8));
  expect(draw(0).every((value) => value >= 0 && value < 1)).toBe(true);
  expect(new Set(draw(3)).size).toBe(5);
});
