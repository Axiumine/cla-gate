// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { setTimeout as sleep } from 'node:timers/promises';
import { type Kysely, sql } from 'kysely';
import { pino } from 'pino';
import { expect, inject, onTestFinished, test, vi } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { type DeliveryId, deliveryIdSchema } from '../../domain/delivery-id.ts';
import { evaluatePullRequest } from '../../domain/evaluation/index.ts';
import type { Job } from '../../domain/jobs.ts';
import type { DestroyedGroup } from '../../domain/webhook-routing-types.ts';
import { githubWorld } from '../../services/evaluate-pr/test-support.ts';
import { registerHandlers } from '../../services/job-handlers.ts';
import { HandlerRegistry } from '../../services/job-registry.ts';
import { addGroup, groupJob } from '../../services/merge-group/test-support.ts';
import { createOrgMembership } from '../../services/org-membership.ts';
import { createOrgMembershipCache } from '../../services/org-membership-cache.ts';
import { systemClock } from '../../services/ports/clock.ts';
import { CheckRunReporter } from '../../services/reporting/check-run-reporter.ts';
import { CheckRunWriter } from '../../services/reporting/check-run-writer.ts';
import { createWebhookDeliveries } from '../../services/webhook-deliveries.ts';
import { markDeliveryProcessed } from '../../services/webhook-delivery-rows.ts';
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

// Two `checks_requested` deliveries for one merge group (E22-S01) on a real PostgreSQL, through the intake service, the queue of the
// application and its workers, with the Check Run written by the real reporter on a FakeGitHub: however the two deliveries meet
// (the queue holds one job per head SHA and runs the next after it), the group has one evaluation row and one Check Run, and a
// second evaluation updates the run of the first. The sends, the workers and the writes run as the runtime role, so the grants of
// migration 018 are the ones the job has. It needs real connections, so it runs in the CI `postgres` job and skips on PGlite.

vi.setConfig({ testTimeout: 120_000 });

const SILENT = pino({ level: 'silent' });
/** How often a worker looks for a job: the shortest interval pg-boss accepts. */
const POLL_SECONDS = 0.5;
const APP = parseGithubId(4242);
const FIRST = deliveryIdSchema.parse('5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c');
const SECOND = deliveryIdSchema.parse('0f1e2d3c-4b5a-4968-8776-655443322110');

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
 * The GitHub of a merge group of pull request 41. With `hold`, the first read of that pull request waits until `release` is
 * resolved, and `waiting` resolves when a job is inside that read.
 */
function scene(hold: boolean) {
  const fake = githubWorld();
  const group = addGroup({ fake }, [41]);
  const waiting = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  if (hold) {
    fake.beforeNext('getPullRequest', async () => {
      waiting.resolve(undefined);
      await release.promise;
    });
  }
  return { fake, group, waiting, release };
}

/**
 * The queue of the application, as the runtime role, with workers whose handler of the group runs on the GitHub of `world` with
 * the real reporter, and the intake service on that queue: what the webhook route records and sends a delivery with.
 */
async function intakeOver(db: Kysely<Database>, { fake, release }: ReturnType<typeof scene>) {
  const registry = new HandlerRegistry();
  const writer = new CheckRunWriter({ github: fake, appId: APP, clock: systemClock, logger: SILENT });
  const reporter = new CheckRunReporter({
    db,
    github: fake,
    writer,
    appId: APP,
    publicBaseUrl: 'https://cla.example.org',
    logger: SILENT,
  });
  registerHandlers(registry, {
    syncInstallation: undefined,
    evaluatePr: () => ({
      db,
      github: fake,
      clock: systemClock,
      orgMembership: createOrgMembership({
        db,
        github: fake,
        logger: SILENT,
        cache: createOrgMembershipCache(systemClock),
      }),
      reporter,
      evaluate: evaluatePullRequest,
    }),
  });
  const queue = await startJobQueue({
    connectionString: runtimeUrl(),
    logger: SILENT,
    workers: {
      registry,
      markDeliveryProcessed: (deliveryId) => markDeliveryProcessed(db, deliveryId),
      clock: systemClock,
      concurrency: 4,
      pollingIntervalSeconds: POLL_SECONDS,
    },
  });
  onTestFinished(async () => {
    release.resolve(undefined);
    await queue.stop();
  });
  const deliveries = createWebhookDeliveries({ db, enqueuer: queue.enqueuer });
  return {
    record: (deliveryId: DeliveryId, job: Job) =>
      deliveries.record({ deliveryId, event: 'merge_group', action: 'checks_requested' }, { ...job, deliveryId }),
    destroy: (deliveryId: DeliveryId, group: Omit<DestroyedGroup, 'deliveryId'>) =>
      deliveries.recordDestroyed({ deliveryId, event: 'merge_group', action: 'destroyed' }, { ...group, deliveryId }),
  };
}

test('the job of a scene names the head SHA of the group and the last pull request of its branch, whatever the delivery', () => {
  const { group } = scene(false);
  expect(groupJob(group)).toEqual({
    type: 'evaluate-merge-group',
    githubInstallationId: group.installation,
    githubRepoId: group.repository,
    headSha: group.head,
    baseSha: group.base,
    tipPrNumber: 41,
  });
});

/** The evaluations of groups and the states of the jobs of the queue, as the owner sees them. */
async function outcome(owner: Kysely<Database>) {
  const rows = await owner
    .selectFrom('merge_group_evaluations')
    .select(['head_sha', 'result', 'check_run_id', 'destroyed_at'])
    .execute();
  const { rows: jobs } = await sql<{ state: string; output: unknown }>`
    select state, output from pgboss.job where name = 'evaluate-merge-group' order by created_on, id`.execute(owner);
  const unprocessed = await owner
    .selectFrom('webhook_deliveries')
    .select('delivery_id')
    .where('processed_at', 'is', null)
    .execute();
  return { rows, jobs, unprocessed };
}

realPostgresRolesOnly(
  'two concurrent checks_requested deliveries for one head SHA leave one evaluation row and one Check Run',
  async () => {
    const { owner, db } = await tenant();
    const world = scene(false);
    const { record } = await intakeOver(db, world);
    const job = groupJob(world.group);
    const answers = await Promise.all([record(FIRST, job), record(SECOND, job)]);
    expect(answers).toEqual(['accepted', 'accepted']);
    await vi.waitFor(
      async () => {
        const { jobs, unprocessed } = await outcome(owner);
        expect(jobs.length).toBeGreaterThanOrEqual(1);
        expect(jobs.every((entry) => entry.state === 'completed')).toBe(true);
        expect(unprocessed).toEqual([]);
      },
      { timeout: 60_000, interval: 250 },
    );
    const { rows } = await outcome(owner);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ head_sha: world.group.head, result: 'failure', destroyed_at: null });
    const runs = world.fake.checkRuns;
    expect(runs).toHaveLength(1);
    expect(runs[0]?.run.headSha).toBe(world.group.head);
    expect(runs[0]?.write).toMatchObject({ status: 'completed', conclusion: 'failure' });
    expect(rows[0]?.check_run_id).toBe(runs[0]?.run.id);
    expect(world.fake.checkRunWrites.filter((write) => write.kind === 'create')).toHaveLength(1);
  },
);

realPostgresRolesOnly(
  'a second delivery that arrives while the first job runs waits behind it, and its run updates the Check Run of the first',
  async () => {
    const { owner, db } = await tenant();
    const world = scene(true);
    const { record } = await intakeOver(db, world);
    const job = groupJob(world.group);
    expect(await record(FIRST, job)).toBe('accepted');
    await world.waiting.promise;
    expect(await record(SECOND, job)).toBe('accepted');
    // The queue keeps the second job behind the first: nothing of it ran while the first is held.
    await sleep(2000);
    expect(world.fake.calls.filter((call) => call.method === 'getPullRequest')).toHaveLength(1);
    expect(world.fake.checkRuns).toEqual([]);
    world.release.resolve(undefined);
    await vi.waitFor(
      async () => {
        const { jobs } = await outcome(owner);
        expect(jobs).toEqual([
          { state: 'completed', output: { outcome: 'evaluated' } },
          { state: 'completed', output: { outcome: 'evaluated' } },
        ]);
      },
      { timeout: 60_000, interval: 250 },
    );
    const { rows, unprocessed } = await outcome(owner);
    expect(unprocessed).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(world.fake.checkRuns).toHaveLength(1);
    expect(world.fake.checkRunWrites.map((write) => write.kind)).toEqual(['create', 'update']);
    expect(rows[0]?.check_run_id).toBe(world.fake.checkRuns[0]?.run.id);
  },
);

realPostgresRolesOnly(
  'a group taken down before its job ran is never evaluated: the tombstone ends the job and no Check Run is written',
  async () => {
    const { owner, db } = await tenant();
    const world = scene(false);
    const { record, destroy } = await intakeOver(db, world);
    const { group } = world;
    const gone = {
      githubInstallationId: group.installation,
      githubRepoId: group.repository,
      headSha: group.head,
      baseSha: group.base,
    };
    expect(await destroy(SECOND, gone)).toBe('accepted');
    expect(await record(FIRST, groupJob(group))).toBe('accepted');
    await vi.waitFor(
      async () => {
        const { jobs, unprocessed } = await outcome(owner);
        expect(jobs).toEqual([{ state: 'completed', output: { outcome: 'skipped:merge_group_destroyed' } }]);
        expect(unprocessed).toEqual([]);
      },
      { timeout: 60_000, interval: 250 },
    );
    const { rows } = await outcome(owner);
    expect(rows).toMatchObject([{ head_sha: group.head, result: 'in_progress', check_run_id: null }]);
    expect(rows[0]?.destroyed_at).toBeInstanceOf(Date);
    expect(world.fake.checkRuns).toEqual([]);
    expect(world.fake.calls.filter((call) => call.method === 'getPullRequest')).toEqual([]);
  },
);
