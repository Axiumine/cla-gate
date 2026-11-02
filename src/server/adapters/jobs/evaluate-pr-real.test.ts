// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { setTimeout as sleep } from 'node:timers/promises';
import { type Kysely, sql } from 'kysely';
import { pino } from 'pino';
import { expect, inject, onTestFinished, test, vi } from 'vitest';
import { evaluatePullRequest } from '../../domain/evaluation/index.ts';
import {
  FakeReporter,
  FULL_NAME,
  githubWorld,
  INSTALLATION,
  JOB,
  PR_NUMBER,
  REPOSITORY,
} from '../../services/evaluate-pr/test-support.ts';
import { account, commit, commitSha, pullRequest } from '../../services/github-pull-contract/test-support.ts';
import { registerHandlers } from '../../services/job-handlers.ts';
import { HandlerRegistry } from '../../services/job-registry.ts';
import { createOrgMembership } from '../../services/org-membership.ts';
import { systemClock } from '../../services/ports/clock.ts';
import { createPgDatabase } from '../db/pg.ts';
import type { Database } from '../db/schema.ts';
import {
  migratedRuntimeDatabase,
  realPostgresRolesOnly,
  requireTestDatabaseUrl,
  seedTenant,
} from '../db/test-support.ts';
import { migrateJobQueues } from './migrate-queues.ts';
import { startJobQueue } from './runtime.ts';

// Two `evaluate-pr` jobs for one pull request through the queue of the application on a real PostgreSQL (E07-S04): the
// first is held while it waits for GitHub the second time (step 8), a push moves the head, the second job is sent and
// waits behind the first (E07-S02), and when the first goes on it finds the head moved and discards its result. The
// second then evaluates the new head. What is left is one row per head SHA, the verdict of the older one never written, and
// the verdict of the newer one reported once. The workers, the sends and the evaluation run as the runtime role, so the
// grants the job needs are the ones the application has. It needs real connections, so it runs in the CI `postgres` job and
// skips on PGlite.

vi.setConfig({ testTimeout: 120_000 });

const SILENT = pino({ level: 'silent' });
/** How often a worker looks for a job: the shortest interval pg-boss accepts. */
const POLL_SECONDS = 0.5;
const NEWER = commitSha(3);

const ownerUrl = (): string => requireTestDatabaseUrl(inject('testDatabaseUrl'));

/** The test database's URL, with every session switched to the runtime role as it connects. */
function runtimeUrl(): string {
  const url = new URL(ownerUrl());
  url.searchParams.set('options', '-c role=cla_app');
  return url.href;
}

/** A migrated database with the queues of the application and a tenant whose repository the job evaluates. */
async function tenant(): Promise<{ owner: Kysely<Database>; db: Kysely<Database> }> {
  const { db: owner } = await migratedRuntimeDatabase();
  await sql`drop schema if exists pgboss cascade`.execute(owner);
  const errors: Error[] = [];
  await migrateJobQueues({ connectionString: ownerUrl(), db: owner, onError: (error) => errors.push(error) });
  const seeded = await seedTenant(owner, 1);
  await sql`update installations set admission_status = 'admitted', admission_reason = null`.execute(owner);
  await owner
    .updateTable('repositories')
    .set({ enabled: true, cla_document_id: seeded.documentId })
    .where('installation_id', '=', seeded.installationId)
    .execute();
  const db = createPgDatabase({ connectionString: runtimeUrl(), onError: (error) => errors.push(error) });
  onTestFinished(async () => {
    await db.destroy();
    expect(errors).toEqual([]);
  });
  return { owner, db };
}

/**
 * What the first job waits for: GitHub as the tests of the job have it, and a reporter that, when it is told the first
 * evaluation began, holds the next read of the pull request (step 8) until `release` is resolved. `waiting` resolves when
 * that read is held.
 */
function scene() {
  const fake = githubWorld();
  const reporter = new FakeReporter();
  const waiting = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  let armed = false;
  reporter.hooks.started = () => {
    if (!armed) {
      armed = true;
      fake.beforeNext('getPullRequest', async () => {
        waiting.resolve(undefined);
        await release.promise;
      });
    }
    return Promise.resolve();
  };
  return { fake, reporter, waiting, release };
}

const TARGET = {
  githubInstallationId: INSTALLATION,
  githubRepoId: REPOSITORY,
  fullName: FULL_NAME,
  prNumber: PR_NUMBER,
  headSha: commitSha(2),
  trigger: 'pull_request',
  evaluationId: 1,
} as const;

test('the scene holds the second read of the pull request until it is released, and the reads after it run free', async () => {
  const { fake, reporter, waiting, release } = scene();
  await reporter.started(TARGET);
  const held = fake.getPullRequest(INSTALLATION, FULL_NAME, PR_NUMBER);
  await waiting.promise;
  release.resolve(undefined);
  expect((await held)?.headSha).toBe(commitSha(2));
  await reporter.started(TARGET);
  expect((await fake.getPullRequest(INSTALLATION, FULL_NAME, PR_NUMBER))?.headSha).toBe(commitSha(2));
});

/** The queue of the application, as the runtime role, with workers whose `evaluate-pr` handler runs the job on `scene`. */
async function workersOver(db: Kysely<Database>, { fake, reporter, release }: ReturnType<typeof scene>) {
  const registry = new HandlerRegistry();
  registerHandlers(registry, {
    syncInstallation: undefined,
    evaluatePr: () => ({
      db,
      github: fake,
      clock: systemClock,
      orgMembership: createOrgMembership({ db, github: fake, logger: SILENT }),
      reporter,
      evaluate: evaluatePullRequest,
    }),
  });
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
  return (trigger: 'pull_request' | 'sweep', key: string) =>
    db.transaction().execute((tx) => queue.enqueuer.enqueue(tx, { ...JOB, trigger }, { idempotencyKey: key }));
}

realPostgresRolesOnly(
  'two jobs for one pull request run one after the other, and the result that stays is the one of the newer head SHA',
  async () => {
    const { owner, db } = await tenant();
    const world = scene();
    const { fake, reporter, waiting, release } = world;
    const send = await workersOver(db, world);
    expect(await send('pull_request', 'first')).toBe('queued');
    await waiting.promise;
    // A push: the head moves, and a second job is sent while the first one is still running.
    fake.addPullRequest(
      INSTALLATION,
      FULL_NAME,
      pullRequest(PR_NUMBER, { headSha: NEWER, commitCount: 3, opener: account(7) }),
    );
    fake.setPullRequestCommits(INSTALLATION, FULL_NAME, PR_NUMBER, [commit(1), commit(2), commit(3)]);
    expect(await send('sweep', 'second')).toBe('queued');
    // The queue keeps the second job behind the first: nothing of it ran while the first is held.
    await sleep(2000);
    expect(reporter.startedTargets).toHaveLength(1);
    release.resolve(undefined);
    await vi.waitFor(
      async () => {
        const { rows } = await sql<{ state: string; output: unknown }>`
          select state, output from pgboss.job where name = 'evaluate-pr' order by created_on, id`.execute(owner);
        expect(rows).toEqual([
          { state: 'completed', output: { outcome: 'superseded' } },
          { state: 'completed', output: { outcome: 'evaluated' } },
        ]);
      },
      { timeout: 60_000, interval: 250 },
    );
    const rows = await owner
      .selectFrom('pr_evaluations')
      .select(['head_sha', 'result', 'details'])
      .orderBy('id')
      .execute();
    expect(rows.map((row) => [row.head_sha, row.result, row.details])).toEqual([
      [commitSha(2), 'in_progress', {}],
      [NEWER, 'failure', expect.objectContaining({ outcome: 'failure' })],
    ]);
    expect(reporter.startedTargets.map((target) => target.headSha)).toEqual([commitSha(2), NEWER]);
    expect(reporter.published.map((report) => [report.target.headSha, report.target.trigger])).toEqual([
      [NEWER, 'sweep'],
    ]);
  },
);
