// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { setTimeout as sleep } from 'node:timers/promises';
import { type Kysely, sql } from 'kysely';
import { pino } from 'pino';
import { expect, inject, onTestFinished, test, vi } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { type Job, jobSchema } from '../../domain/jobs.ts';
import {
  FULL_NAME,
  githubWorld,
  INSTALLATION,
  PR_NUMBER,
  REPOSITORY,
} from '../../services/evaluate-pr/test-support.ts';
import { comment, pullRef } from '../../services/github-comment-contract/test-support.ts';
import { commitSha, pullRequest } from '../../services/github-pull-contract/test-support.ts';
import { HandlerRegistry } from '../../services/job-registry.ts';
import { systemClock } from '../../services/ports/clock.ts';
import { recheckComment } from '../../services/recheck/recheck-comment.ts';
import { rerunHeadSha } from '../../services/recheck/rerun-head-sha.ts';
import { createPgDatabase } from '../db/pg.ts';
import type { Database } from '../db/schema.ts';
import {
  migratedRuntimeDatabase,
  realPostgresRolesOnly,
  requireTestDatabaseUrl,
  seedTenant,
} from '../db/test-support.ts';
import { jobIdFor } from './job-id.ts';
import { migrateJobQueues } from './migrate-queues.ts';
import { startJobQueue } from './runtime.ts';

// The manual re-evaluation on the queue of the application, on a real PostgreSQL (E07-S07): the `recheck-comment` and
// `evaluate-head-sha` jobs, run by the workers as the runtime role, send `evaluate-pr` jobs through the pg-boss enqueuer
// under the dedupe key of the pull request and a window of 60 seconds. Two commands in one window leave one evaluation, even
// when the two jobs run at the same moment; a window later the next command is sent; a Re-run shares the window of a
// `/recheck`. pg-boss counts the window on the clock of the database, which a test cannot move: it waits for a place in the
// window that leaves room for the sends, and it moves a window on by moving the slot of the job it holds back by 61 seconds,
// which is the slot a send made that long ago would have taken. It needs real connections and the runtime role, so it runs in
// the CI `postgres` job and skips on PGlite; the code it goes through is covered by the unit tests of the job.

vi.setConfig({ testTimeout: 120_000 });

const SILENT = pino({ level: 'silent' });
/** How often a worker looks for a job: the shortest interval pg-boss accepts. */
const POLL_SECONDS = 0.5;
const HEAD = commitSha(2);
const WINDOW_SECONDS = 60;

const ownerUrl = (): string => requireTestDatabaseUrl(inject('testDatabaseUrl'));

/** The test database's URL, with every session switched to the runtime role as it connects. */
function runtimeUrl(): string {
  const url = new URL(ownerUrl());
  url.searchParams.set('options', '-c role=cla_app');
  return url.href;
}

const mine = { githubInstallationId: INSTALLATION, githubRepoId: REPOSITORY };

const commentJob = (commentId: number): Job => ({
  type: 'recheck-comment',
  ...mine,
  prNumber: PR_NUMBER,
  commentId: parseGithubId(commentId),
});
const HEAD_JOB: Job = { type: 'evaluate-head-sha', ...mine, headSha: HEAD };

/** Waits for the clock of the database to be early enough in a window that the sends of a test fall in one. */
async function awaitRoomInWindow(owner: Kysely<Database>): Promise<void> {
  const { rows } = await sql<{ left: number }>`
    select (${WINDOW_SECONDS} - extract(epoch from now())::bigint % ${WINDOW_SECONDS})::int as left`.execute(owner);
  const left = rows[0]?.left ?? WINDOW_SECONDS;
  if (left < 6) {
    await sleep((left + 1) * 1000);
  }
}

test('the jobs of the scene are jobs of the catalogue, and each is sent under a key of its own', () => {
  const jobs = [commentJob(5001), commentJob(5002), commentJob(5003), HEAD_JOB];
  for (const job of jobs) {
    expect(jobSchema.parse(job)).toEqual(job);
  }
  expect(new Set(jobs.map((_, index) => jobIdFor(`delivery-${index}`))).size).toBe(jobs.length);
});

/** A migrated database with the queues and a tenant whose repository is enabled. */
async function migratedTenant(errors: Error[]) {
  const { db: owner } = await migratedRuntimeDatabase();
  await sql`drop schema if exists pgboss cascade`.execute(owner);
  await migrateJobQueues({ connectionString: ownerUrl(), db: owner, onError: (error) => errors.push(error) });
  const tenant = await seedTenant(owner, 1);
  await sql`update installations set admission_status = 'admitted', admission_reason = null`.execute(owner);
  await owner
    .updateTable('repositories')
    .set({ enabled: true, cla_document_id: tenant.documentId })
    .where('installation_id', '=', tenant.installationId)
    .execute();
  return owner;
}

/** A GitHub whose pull requests 7 and 8 are open at one head SHA and which holds the three comments of the tests. */
function githubWithComments() {
  const fake = githubWorld();
  fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(8));
  for (const id of [5001, 5002, 5003]) {
    fake.addIssueComment(INSTALLATION, FULL_NAME, comment(parseGithubId(id)));
  }
  fake.setCommitPullRequests(INSTALLATION, FULL_NAME, HEAD, [pullRef(PR_NUMBER), pullRef(8)]);
  return fake;
}

/** The workers of the application for the two jobs: the real handlers over `db`, the runtime role. */
function recheckRegistry(db: Kysely<Database>): HandlerRegistry {
  const ports = { db, github: githubWithComments(), clock: systemClock };
  const registry = new HandlerRegistry();
  registry.register('recheck-comment', (job, { logger, enqueuer, jobId }) =>
    recheckComment(ports, job, { logger, enqueuer, jobId }),
  );
  registry.register('evaluate-head-sha', (job, { logger, enqueuer, jobId }) =>
    rerunHeadSha(ports, job, { logger, enqueuer, jobId }),
  );
  return registry;
}

/** The queue schema and a tenant, the workers of {@link recheckRegistry} as the runtime role, all stopped after the test. */
async function scene() {
  const errors: Error[] = [];
  const owner = await migratedTenant(errors);
  const db = createPgDatabase({ connectionString: runtimeUrl(), onError: (error) => errors.push(error) });
  const queue = await startJobQueue({
    connectionString: runtimeUrl(),
    logger: SILENT,
    workers: {
      registry: recheckRegistry(db),
      markDeliveryProcessed: () => Promise.resolve(),
      clock: systemClock,
      concurrency: 4,
      pollingIntervalSeconds: POLL_SECONDS,
    },
  });
  onTestFinished(async () => {
    await queue.stop();
    await db.destroy();
    expect(errors).toEqual([]);
  });
  await awaitRoomInWindow(owner);
  return {
    owner,
    /** Sends a job as the webhook intake does, in a transaction of its own, under the key a delivery would give it. */
    send: (key: string, job: Job) =>
      db.transaction().execute((tx) => queue.enqueuer.enqueue(tx, job, { idempotencyKey: key })),
  };
}

type World = Awaited<ReturnType<typeof scene>>;

/** What the job sent under `key` ended with, once it has ended. */
async function ended(world: World, key: string): Promise<unknown> {
  let output: unknown;
  await vi.waitFor(
    async () => {
      const { rows } = await sql<{ state: string; output: unknown }>`
        select state, output from pgboss.job where id = ${jobIdFor(key)}`.execute(world.owner);
      expect(rows[0]?.state).toBe('completed');
      output = rows[0]?.output;
    },
    { timeout: 60_000, interval: 250 },
  );
  return output;
}

/** The evaluations on the queue, oldest first: what each is for and under which pull request it queues. */
async function evaluations(owner: Kysely<Database>) {
  const { rows } = await sql<{ singleton_key: string; data: { prNumber: number; trigger: string } }>`
    select singleton_key, data from pgboss.job where name = 'evaluate-pr' order by created_on, singleton_key`.execute(
    owner,
  );
  return rows.map((row) => [row.singleton_key, row.data.trigger]);
}

realPostgresRolesOnly(
  'two commands at the same moment leave one evaluation on the queue, and the next one a window later is sent',
  async () => {
    const world = await scene();
    expect(await world.send('delivery-1', commentJob(5001))).toBe('queued');
    expect(await world.send('delivery-2', commentJob(5002))).toBe('queued');
    const outcomes = [await ended(world, 'delivery-1'), await ended(world, 'delivery-2')];
    expect(outcomes.map((output) => JSON.stringify(output)).toSorted((a, b) => a.localeCompare(b))).toEqual([
      JSON.stringify({ outcome: 'enqueued' }),
      JSON.stringify({ outcome: 'rate_limited' }),
    ]);
    expect(await evaluations(world.owner)).toEqual([[`${REPOSITORY}:${PR_NUMBER}`, 'recheck']]);
    // 61 seconds later: the slot the first send took is that long ago.
    await sql`update pgboss.job set singleton_on = singleton_on - interval '61 seconds' where name = 'evaluate-pr'`.execute(
      world.owner,
    );
    expect(await world.send('delivery-3', commentJob(5003))).toBe('queued');
    expect(await ended(world, 'delivery-3')).toEqual({ outcome: 'enqueued' });
    expect(await evaluations(world.owner)).toEqual([
      [`${REPOSITORY}:${PR_NUMBER}`, 'recheck'],
      [`${REPOSITORY}:${PR_NUMBER}`, 'recheck'],
    ]);
  },
);

realPostgresRolesOnly(
  'a Re-run sends an evaluation for each open pull request of the head SHA, and shares the window of a /recheck on the same pull request',
  async () => {
    const world = await scene();
    expect(await world.send('delivery-1', commentJob(5001))).toBe('queued');
    expect(await ended(world, 'delivery-1')).toEqual({ outcome: 'enqueued' });
    expect(await world.send('delivery-2', HEAD_JOB)).toBe('queued');
    expect(await ended(world, 'delivery-2')).toEqual({ outcome: 'enqueued' });
    expect(await evaluations(world.owner)).toEqual([
      [`${REPOSITORY}:${PR_NUMBER}`, 'recheck'],
      [`${REPOSITORY}:8`, 'check_rerequested'],
    ]);
    expect(await world.send('delivery-3', { ...HEAD_JOB })).toBe('queued');
    expect(await world.send('delivery-4', { ...HEAD_JOB, headSha: commitSha(3) })).toBe('queued');
    expect(await ended(world, 'delivery-3')).toEqual({ outcome: 'rate_limited' });
    expect(await ended(world, 'delivery-4')).toEqual({ outcome: 'skipped:no_pull_request' });
    expect(await evaluations(world.owner)).toHaveLength(2);
  },
);
