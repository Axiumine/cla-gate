// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { pino } from 'pino';
import { expect, inject, onTestFinished, test, vi } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { type Job, jobSchema } from '../../domain/jobs.ts';
import { closePr } from '../../services/close-pr/close-pr.ts';
import {
  FakeReporter,
  FULL_NAME,
  githubWorld,
  INSTALLATION,
  PR_NUMBER,
  REPOSITORY,
} from '../../services/evaluate-pr/test-support.ts';
import { commitSha, pullRequest } from '../../services/github-pull-contract/test-support.ts';
import { HandlerRegistry } from '../../services/job-registry.ts';
import { systemClock } from '../../services/ports/clock.ts';
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

// The closing of a pull request on the queue of the application, on a real PostgreSQL (E07-S06): the `close-pr` job, run by
// the workers as the runtime role, cancels through pg-boss's API the jobs that wait for the pull request and no others. A job
// that runs is left to finish, the jobs of another pull request and of another installation stay, a second close is harmless,
// and the evaluation in progress ends cancelled and is reported so. It needs real connections and the runtime role, so it
// runs in the CI `postgres` job and skips on PGlite; the code it goes through is covered by the unit tests of the adapter.

vi.setConfig({ testTimeout: 120_000 });

const SILENT = pino({ level: 'silent' });
/** How often a worker looks for a job: the shortest interval pg-boss accepts. */
const POLL_SECONDS = 0.5;
const HEAD = commitSha(2);
const OTHER_HEAD = commitSha(3);

const ownerUrl = (): string => requireTestDatabaseUrl(inject('testDatabaseUrl'));

/** The test database's URL, with every session switched to the runtime role as it connects. */
function runtimeUrl(): string {
  const url = new URL(ownerUrl());
  url.searchParams.set('options', '-c role=cla_app');
  return url.href;
}

const mine = { githubInstallationId: INSTALLATION, githubRepoId: REPOSITORY };
/** Another installation that names the repository of `mine`: hostile data, which must not select anything of ours. */
const stranger = { githubInstallationId: parseGithubId(10_000), githubRepoId: REPOSITORY };

const RUNNING: Job = { type: 'evaluate-pr', ...mine, prNumber: PR_NUMBER, trigger: 'pull_request' };
const WAITING: Job = { type: 'evaluate-pr', ...mine, prNumber: PR_NUMBER, trigger: 'sweep' };

/** The jobs on the queue next to the running one, by the key they are sent under, and what each one is. */
const QUEUED: Readonly<Record<string, Job>> = {
  waiting: WAITING,
  otherPullRequest: { type: 'evaluate-pr', ...mine, prNumber: 8, trigger: 'pull_request' },
  otherInstallation: { type: 'evaluate-pr', ...stranger, prNumber: PR_NUMBER, trigger: 'pull_request' },
  headOfThePullRequest: { type: 'evaluate-head-sha', ...mine, headSha: HEAD },
  headOfAnother: { type: 'evaluate-head-sha', ...mine, headSha: OTHER_HEAD },
  headOfOtherInstallation: { type: 'evaluate-head-sha', ...stranger, headSha: HEAD },
  recheck: { type: 'recheck-comment', ...mine, prNumber: PR_NUMBER, commentId: parseGithubId(7001) },
  recheckOfAnother: { type: 'recheck-comment', ...mine, prNumber: 8, commentId: parseGithubId(7002) },
};
const CLOSE: Job = { type: 'close-pr', ...mine, prNumber: PR_NUMBER };

test('every job of the scene is a job of the catalogue, and a different one of them is sent under every key', () => {
  const sent = { running: RUNNING, ...QUEUED, close: CLOSE };
  for (const job of Object.values(sent)) {
    expect(jobSchema.parse(job)).toEqual(job);
  }
  expect(new Set(Object.keys(sent).map(jobIdFor)).size).toBe(Object.keys(sent).length);
});

/** A migrated database with the queues and a tenant whose pull request 7 is closed on GitHub and has an evaluation in progress. */
async function scene() {
  const { db: owner } = await migratedRuntimeDatabase();
  await sql`drop schema if exists pgboss cascade`.execute(owner);
  const errors: Error[] = [];
  await migrateJobQueues({ connectionString: ownerUrl(), db: owner, onError: (error) => errors.push(error) });
  const tenant = await seedTenant(owner, 1);
  await sql`update installations set admission_status = 'admitted', admission_reason = null`.execute(owner);
  await owner
    .updateTable('repositories')
    .set({ enabled: true, cla_document_id: tenant.documentId })
    .where('installation_id', '=', tenant.installationId)
    .execute();
  await owner
    .insertInto('pr_evaluations')
    .values({
      installation_id: tenant.installationId,
      repository_id: tenant.repositoryId,
      pr_number: PR_NUMBER,
      head_sha: HEAD,
      result: 'in_progress',
    })
    .execute();
  const db = createPgDatabase({ connectionString: runtimeUrl(), onError: (error) => errors.push(error) });
  onTestFinished(async () => {
    await db.destroy();
    expect(errors).toEqual([]);
  });
  const fake = githubWorld();
  fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(PR_NUMBER, { state: 'closed' }));
  return { owner, db, fake, reporter: new FakeReporter() };
}

/**
 * The workers of the application over `db`: `evaluate-pr` is held until `release` (or fails at once with `failing`, which
 * sends the job to wait for its retry), and `close-pr` is the real handler.
 */
async function workers({ db, fake, reporter }: Awaited<ReturnType<typeof scene>>, options: { failing?: boolean } = {}) {
  const release = Promise.withResolvers<undefined>();
  const evaluations: string[] = [];
  const registry = new HandlerRegistry();
  registry.register('evaluate-pr', async (job) => {
    evaluations.push(`${job.githubInstallationId}:${job.prNumber}:${job.trigger}`);
    if (options.failing === true) {
      throw new Error('GitHub is down');
    }
    await release.promise;
    return { outcome: 'held' };
  });
  registry.register('close-pr', (job, { logger, pending }) =>
    closePr({ db, github: fake, clock: systemClock, reporter }, job, { logger, pending }),
  );
  const queue = await startJobQueue({
    connectionString: runtimeUrl(),
    logger: SILENT,
    workers: {
      registry,
      markDeliveryProcessed: () => Promise.resolve(),
      clock: systemClock,
      concurrency: 4,
      pollingIntervalSeconds: POLL_SECONDS,
    },
  });
  onTestFinished(async () => {
    release.resolve(undefined);
    await queue.stop();
  });
  return {
    evaluations,
    release: () => {
      release.resolve(undefined);
    },
    send: async (key: string, job: Job) =>
      db.transaction().execute((tx) => queue.enqueuer.enqueue(tx, job, { idempotencyKey: key })),
  };
}

/** The state of every job sent, by the key it was sent under. */
async function states(owner: Kysely<Database>): Promise<Record<string, string>> {
  const { rows } = await sql<{ id: string; state: string }>`select id, state from pgboss.job`.execute(owner);
  const byId = new Map(rows.map((row) => [row.id, row.state]));
  return Object.fromEntries(
    ['running', ...Object.keys(QUEUED), 'close', 'closeAgain']
      .map((key) => [key, byId.get(jobIdFor(key))] as const)
      .filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

const closed = (owner: Kysely<Database>, key: string) =>
  vi.waitFor(
    async () => {
      const { rows } = await sql<{ state: string; output: unknown }>`
        select state, output from pgboss.job where id = ${jobIdFor(key)}`.execute(owner);
      expect(rows).toEqual([{ state: 'completed', output: { outcome: 'closed' } }]);
    },
    { timeout: 60_000, interval: 250 },
  );

realPostgresRolesOnly(
  'closing a pull request cancels the jobs that wait for it, as the runtime role, and leaves the job that runs, the other pull request and the other installation',
  async () => {
    const world = await scene();
    const queue = await workers(world);
    expect(await queue.send('running', RUNNING)).toBe('queued');
    await vi.waitFor(
      () => {
        expect(queue.evaluations).toEqual(['5000:7:pull_request']);
      },
      { timeout: 60_000 },
    );
    for (const [key, job] of Object.entries(QUEUED)) {
      expect(await queue.send(key, job)).toBe('queued');
    }
    // The waiting job queues behind the running one of the same pull request; the one of the other installation does so
    // as well, because the queue serialises by repository and pull request number.
    expect(await queue.send('close', CLOSE)).toBe('queued');
    await closed(world.owner, 'close');
    expect(await states(world.owner)).toEqual({
      running: 'active',
      waiting: 'cancelled',
      otherPullRequest: 'active',
      otherInstallation: 'created',
      headOfThePullRequest: 'cancelled',
      headOfAnother: 'created',
      headOfOtherInstallation: 'created',
      recheck: 'cancelled',
      recheckOfAnother: 'created',
      close: 'completed',
    });
    // The evaluation in progress is cancelled and its Check Run reported so.
    const rows = await world.owner.selectFrom('pr_evaluations').select(['head_sha', 'result']).execute();
    expect(rows).toEqual([{ head_sha: HEAD, result: 'cancelled' }]);
    expect(world.reporter.cancellations.map((target) => target.headSha)).toEqual([HEAD]);
  },
);

realPostgresRolesOnly(
  'a second close of the same pull request is harmless, and what ran is not cancelled when it finishes',
  async () => {
    const world = await scene();
    const queue = await workers(world);
    await queue.send('running', RUNNING);
    await vi.waitFor(
      () => {
        expect(queue.evaluations).toHaveLength(1);
      },
      { timeout: 60_000 },
    );
    await queue.send('waiting', WAITING);
    await queue.send('close', CLOSE);
    await closed(world.owner, 'close');
    await queue.send('closeAgain', CLOSE);
    await closed(world.owner, 'closeAgain');
    expect(world.reporter.cancellations).toHaveLength(1);
    queue.release();
    await vi.waitFor(
      async () => {
        expect(await states(world.owner)).toMatchObject({ running: 'completed', waiting: 'cancelled' });
      },
      { timeout: 60_000, interval: 250 },
    );
    expect(queue.evaluations).toEqual(['5000:7:pull_request']);
  },
);

realPostgresRolesOnly('a job that waits for its retry is cancelled as well', async () => {
  const world = await scene();
  const queue = await workers(world, { failing: true });
  await queue.send('running', RUNNING);
  await vi.waitFor(
    async () => {
      expect(await states(world.owner)).toEqual({ running: 'retry' });
    },
    { timeout: 60_000, interval: 250 },
  );
  await queue.send('close', CLOSE);
  await closed(world.owner, 'close');
  expect(await states(world.owner)).toEqual({ running: 'cancelled', close: 'completed' });
  expect(queue.evaluations).toEqual(['5000:7:pull_request']);
});
