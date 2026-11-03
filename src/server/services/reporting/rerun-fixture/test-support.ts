// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { type Kysely, sql } from 'kysely';
import { expect, type Mock } from 'vitest';
import { parseGithubId } from '../../../../shared/github-id.ts';
import type { Database } from '../../../adapters/db/schema.ts';
import { seedTenant, type Tenant } from '../../../adapters/db/test-support.ts';
import { type WebhookEvent, webhookFixture, withValue } from '../../../adapters/github/webhook-fixture/test-support.ts';
import { createLogger } from '../../../adapters/http/logger.ts';
import { deliveryHeaders, postDelivery, SECRET_CURRENT } from '../../../adapters/http/test-support.ts';
import type { Evaluation, EvaluationInput } from '../../../domain/evaluation/index.ts';
import { jobEnvelopeSchema } from '../../../domain/job-envelope.ts';
import { testApp } from '../../../test-support.ts';
import type { EvaluateWorld } from '../../evaluate-pr/test-support.ts';
import { pullRef } from '../../github-comment-contract/test-support.ts';
import { untouched } from '../../installation-sync-model.ts';
import { registerHandlers } from '../../job-handlers.ts';
import { HandlerRegistry } from '../../job-registry.ts';
import { type JobRunDeps, runJob } from '../../job-run.ts';
import { FakePendingJobs } from '../../job-run-fixture/test-support.ts';
import type { QueuedJob } from '../../ports/jobs.ts';
import {
  COMMENT_ID,
  FULL_NAME,
  HEAD,
  INSTALLATION,
  PR_NUMBER,
  REPOSITORY,
  type RecheckWorld,
  recheckWorld,
} from '../../recheck/test-support.ts';
import type { FakeClock, FakeGitHub } from '../../test-support.ts';
import { markDeliveryProcessed } from '../../webhook-delivery-rows.ts';
import { createCheckRunReporter } from '../create-check-run-reporter.ts';
import { APP, BASE_URL, FAILING } from '../test-support.ts';

// The world of the end-to-end tests of re-running the check (E09-S08): the real webhook route on the database of the tenant `org-1`
// with signed deliveries, the jobs the route sends (they are in a table of the database, as the tests of the intake have them),
// run by the real job wrapper and the real handlers of the application, the real Check Run reporter, a FakeGitHub that serves the
// tenant, and an engine that is a stub. Nothing is mocked between the delivery and the call to GitHub.

export { COMMENT_ID, FULL_NAME, HEAD, INSTALLATION, PR_NUMBER, REPOSITORY };

/** The ids a delivery names its tenant by. */
export interface TenantIds {
  readonly installation: number;
  readonly repository: number;
}

/** The tenant `org-1` of the world. */
export const ORG_1: TenantIds = { installation: INSTALLATION, repository: REPOSITORY };

/** The Check Run writes of the world, one entry per `POST` or `PATCH` in order: `POST 9000001 in_progress`, `PATCH 9000001 completed success`. */
export function writesOf(fake: FakeGitHub): string[] {
  return fake.checkRunWrites.map(({ kind, id, write }) =>
    [kind === 'create' ? 'POST' : 'PATCH', id, write.status, write.conclusion]
      .filter((part) => part !== undefined)
      .join(' '),
  );
}

/** The ids of the Check Runs of the world, in the order they were posted. */
export function runIds(fake: FakeGitHub): number[] {
  return fake.checkRuns.map((stored) => stored.run.id);
}

export interface RerunWorld {
  readonly fake: FakeGitHub;
  readonly raw: Kysely<Database>;
  readonly tenant: Tenant;
  readonly clock: FakeClock;
  readonly logs: EvaluateWorld['logs'];
  /** The engine of the jobs: a stub that passes, until a test brings a verdict. */
  readonly evaluate: Mock<(input: EvaluationInput) => Evaluation>;
  readonly rows: EvaluateWorld['rows'];
  readonly app: FastifyInstance;
  /** The installations the `sync-installation` jobs that ran were asked to sync, in order. */
  readonly synced: number[];
  /** Posts a signed delivery of `event`: the fixture of the event with the ids of the tenant `org-1` unless `payload` is given. */
  readonly deliver: (event: RerunEvent, payload?: Record<string, unknown>) => ReturnType<typeof postDelivery>;
  /**
   * Runs the jobs of the queue, oldest first, until none waits, with the job wrapper and the handlers of the application: the jobs
   * that were sent (`created`) as the first run of each, or with `retry` those that failed before as its second. A job that fails
   * stays for the retry. Answers `<type>:<outcome>`, or `<type>:failed`, for each job that ran.
   */
  readonly drain: (retry?: boolean) => Promise<string[]>;
  /** Puts `job` on the queue as the intake or a handler would have, under a key of its own: a job that was sent before the state of the tenant changed. */
  readonly send: (job: QueuedJob) => Promise<void>;
  /** Every job the route and the handlers sent, oldest first. */
  readonly queued: RecheckWorld['queued'];
}

/** The events of the world's pull request that a test delivers. */
export type RerunEvent = Extract<WebhookEvent, 'check_run' | 'check_suite' | 'pull_request' | 'issue_comment'>;

/** What `event` changes besides the ids of its tenant: the commit it is about, or the comment it carries. */
function changeOf(event: RerunEvent, headSha: string): readonly [path: string, value: unknown] {
  switch (event) {
    case 'check_run':
      return ['check_run.head_sha', headSha];
    case 'check_suite':
      return ['check_suite.head_sha', headSha];
    case 'pull_request':
      return ['pull_request.head.sha', headSha];
    case 'issue_comment':
      return ['comment.id', COMMENT_ID];
  }
}

/** The fixture of `event` naming `tenant`, with `headSha` as the commit of the check or pull request and the comment of the world as its comment. */
export function tenantPayload(event: RerunEvent, tenant: TenantIds, headSha: string): Record<string, unknown> {
  const named = withValue(
    withValue(webhookFixture(event), 'installation.id', tenant.installation),
    'repository.id',
    tenant.repository,
  );
  return withValue(named, ...changeOf(event, headSha));
}

/** The first job in `state` after the job `after`, oldest first. */
async function nextJob(db: Kysely<Database>, state: string, after: number) {
  const { rows } = await sql<{ id: number; job: unknown }>`
    select id::integer as id, job from fake_jobs where state = ${state} and id > ${after} order by id limit 1`.execute(
    db,
  );
  return rows[0];
}

/** Runs the jobs of the queue in `state`, oldest first, with the wrapper `deps` stand for: what a drain of the world does. */
async function runQueue(db: Kysely<Database>, deps: JobRunDeps, state: 'created' | 'retry'): Promise<string[]> {
  const ran: string[] = [];
  let after = 0;
  for (let next = await nextJob(db, state, after); next !== undefined; next = await nextJob(db, state, after)) {
    after = next.id;
    const { type } = jobEnvelopeSchema.parse(next.job);
    const job = {
      id: `job-${next.id}`,
      data: next.job,
      retryCount: state === 'retry' ? 1 : 0,
      signal: new AbortController().signal,
    };
    try {
      const verdict = await runJob(type, job, deps);
      ran.push(`${type}:${String(verdict.output['outcome'])}`);
      await sql`update fake_jobs set state = 'completed' where id = ${next.id}`.execute(db);
    } catch {
      ran.push(`${type}:failed`);
      await sql`update fake_jobs set state = 'retry' where id = ${next.id}`.execute(db);
    }
  }
  return ran;
}

/**
 * What the job wrapper runs the jobs of `world` with: the handlers of the application on the real reporter and the engine stub, and
 * the delivery rows of the database. A `sync-installation` job notes the installation in `synced` and changes nothing.
 */
function wrapperOf(world: RecheckWorld, synced: number[]): JobRunDeps {
  const { raw, fake, clock, enqueuer, logs } = world;
  const logger = createLogger({ logLevel: 'info' }, logs.destination);
  const reporter = createCheckRunReporter({
    db: raw,
    github: fake,
    appId: APP,
    publicBaseUrl: BASE_URL,
    clock,
    logger,
  });
  const registry = new HandlerRegistry();
  registerHandlers(registry, {
    syncInstallation: (githubInstallationId) => {
      synced.push(githubInstallationId);
      return Promise.resolve(untouched('synced'));
    },
    evaluatePr: (signal) => ({ ...world.ports, clock, reporter, github: fake.withSignal(signal) }),
  });
  return {
    registry,
    markDeliveryProcessed: (deliveryId) => markDeliveryProcessed(raw, deliveryId),
    clock,
    logger,
    pending: new FakePendingJobs(),
    enqueuer,
  };
}

/**
 * The world of the end-to-end tests of re-running the check. Pull request 7 of the tenant is open at {@link HEAD}; the options are
 * those of the world of the tests of the `evaluate-pr` job.
 */
export async function rerunWorld(
  options: Omit<NonNullable<Parameters<typeof recheckWorld>[0]>, 'own'> = {},
): Promise<RerunWorld> {
  const world = await recheckWorld({ ...options, own: true });
  const { raw, fake, clock, enqueuer } = world;
  // GitHub lists pull request 7 for its head SHA, as it does for the commit of every open pull request.
  fake.setCommitPullRequests(INSTALLATION, FULL_NAME, HEAD, [pullRef(PR_NUMBER)]);
  const synced: number[] = [];
  const deps = wrapperOf(world, synced);
  const env = { GITHUB_APP_ID: String(APP), GITHUB_WEBHOOK_SECRET: SECRET_CURRENT };
  const { app } = await testApp({ env, db: raw, clock, enqueuer });
  return {
    fake,
    raw,
    tenant: world.tenant,
    clock,
    logs: world.logs,
    evaluate: world.evaluate,
    rows: world.rows,
    app,
    synced,
    deliver: (event, payload = tenantPayload(event, ORG_1, HEAD)) => {
      const body = JSON.stringify(payload);
      const headers = { 'x-github-event': event, 'x-github-delivery': randomUUID() };
      return postDelivery(app, body, deliveryHeaders(body, { headers }));
    },
    drain: (retry = false) => runQueue(raw, deps, retry ? 'retry' : 'created'),
    send: async (job) => {
      await raw.transaction().execute((tx) => enqueuer.enqueue(tx, job, { idempotencyKey: randomUUID() }));
    },
    queued: world.queued,
  };
}

/**
 * The first evaluation of pull request 7, from its `pull_request` delivery: the engine finds one contributor who has not signed, so
 * the Check Run of the head SHA is posted and completed `failure`, which is what a person asks to run again.
 */
export async function evaluateFirst(world: RerunWorld): Promise<void> {
  world.evaluate.mockReturnValueOnce(FAILING);
  expect((await world.deliver('pull_request')).statusCode).toBe(202);
  expect(await world.drain()).toEqual(['evaluate-pr:evaluated']);
  expect(writesOf(world.fake)).toHaveLength(2);
}

/**
 * A second tenant, `org-2`, admitted and enforcing, whose installation and repository GitHub serves too. A delivery that names its
 * installation and a repository of `org-1` is the stale state of a transfer, and nothing of `org-1` may be written for it.
 * @returns the ids of the tenant.
 */
export async function addSecondTenant(world: RerunWorld): Promise<TenantIds> {
  const { raw, fake } = world;
  const second = await seedTenant(raw, 2);
  await sql`update installations set admission_status = 'admitted', admission_reason = null where id = ${second.installationId}`.execute(
    raw,
  );
  await raw
    .updateTable('repositories')
    .set({ enabled: true, cla_document_id: second.documentId })
    .where('installation_id', '=', second.installationId)
    .execute();
  const ids = { installation: 2 * 5000, repository: 2 * 9000 };
  fake.addInstallation(
    {
      id: parseGithubId(ids.installation),
      account: { id: parseGithubId(2 * 7000), login: 'org-2', type: 'Organization' },
      suspendedAt: null,
      permissions: {},
    },
    [{ id: parseGithubId(ids.repository), fullName: 'org-2/repo' }],
  );
  return ids;
}

/**
 * `org-1` was not touched: GitHub was not asked for anything, no Check Run or comment was written, and the database holds no
 * evaluation, for the pull request or any other.
 */
export async function expectNothingWritten(world: RerunWorld): Promise<void> {
  expect(world.fake.calls).toEqual([]);
  expect(world.fake.checkRunWrites).toEqual([]);
  expect(await world.rows()).toEqual([]);
}
