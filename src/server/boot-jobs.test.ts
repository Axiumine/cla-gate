// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { parseGithubId } from '../shared/github-id.ts';
import { migratedTestDatabase } from './adapters/db/test-support.ts';
import { createLogger } from './adapters/http/logger.ts';
import type { InstallationWiring } from './boot-installations.ts';
import { jobWorkers } from './boot-jobs.ts';
import { deliveryIdSchema } from './domain/delivery-id.ts';
import { JOB_TYPES } from './domain/job-envelope.ts';
import { CLOSE_JOB, HEAD, seedEvaluation } from './services/close-pr/test-support.ts';
import { deadLetterRegistry } from './services/dead-letter/dead-letter-registry.ts';
import {
  allow,
  enrol,
  evaluateWorld,
  FULL_NAME,
  JOB,
  lookups,
  ORG,
  PR_NUMBER,
  INSTALLATION as TENANT_INSTALLATION,
} from './services/evaluate-pr/test-support.ts';
import { pullRequest } from './services/github-pull-contract/test-support.ts';
import type { InstallationSync } from './services/installation-sync.ts';
import { HandlerUnavailableError } from './services/job-handlers.ts';
import { HandlerRegisteredError, type JobHandler } from './services/job-registry.ts';
import { FakePendingJobs } from './services/job-run-fixture/test-support.ts';
import { createJobsTable, deliveryRows, droppingEnqueuer, fakeEnqueuer } from './services/jobs-fixture/test-support.ts';
import { MEMBER_TTL_MS } from './services/org-membership-cache.ts';
import { FakeClock } from './services/test-support.ts';
import { createWebhookDeliveries } from './services/webhook-deliveries.ts';
import { testConfig } from './test-support.ts';

// What boot hands the job workers (E07-S03): the registry with its handlers, the delivery marker on the database, the
// clock and the concurrency of the configuration.

const DELIVERY = deliveryIdSchema.parse('5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c');
const INSTALLATION = parseGithubId(31_001);
const SYNCED = { status: 'synced', changed: true, repositories: { added: 0, renamed: 0, removed: 0 } } as const;
const CONTEXT = {
  jobId: 'job-1',
  attempt: 0,
  logger: createLogger({ logLevel: 'silent' }),
  pending: new FakePendingJobs(),
  enqueuer: droppingEnqueuer,
};

async function wiring(syncFor: InstallationWiring['syncFor'], env: Record<string, string> = {}) {
  const { db } = await migratedTestDatabase();
  await createJobsTable(db);
  return {
    db,
    workers: jobWorkers({
      db,
      config: testConfig(env),
      logger: createLogger({ logLevel: 'silent' }),
      syncFor,
      clock: new FakeClock('2026-11-02T10:00:00Z'),
    }),
  };
}

test('the registry binds the eight handlers of the application, the three types whose consumers come later have none, and the concurrency is the one of the configuration', async () => {
  const { workers } = await wiring(undefined, { WORKER_CONCURRENCY: '7' });
  const later = ['revoke-user-sessions', 'finalise-repository', 'finalise-check'];
  expect(workers.registry.types()).toEqual(JOB_TYPES.filter((type) => !later.includes(type)));
  expect(workers.registry.types()).toHaveLength(8);
  expect(workers.concurrency).toBe(7);
});

test('the register option binds the handler of a job type whose epic comes later, after the ones of the application, and a type that has one is refused', async () => {
  const { db } = await migratedTestDatabase();
  const handler = vi.fn<JobHandler<'revoke-user-sessions'>>(() => Promise.resolve({ outcome: 'revoked' }));
  const workers = jobWorkers({
    db,
    config: testConfig(),
    logger: CONTEXT.logger,
    syncFor: undefined,
    register: (registry) => {
      registry.register('revoke-user-sessions', handler);
    },
  });
  expect(workers.registry.types()).toContain('revoke-user-sessions');
  const job = { type: 'revoke-user-sessions', githubUserId: INSTALLATION } as const;
  const outcome = await workers.registry.run('revoke-user-sessions', job, {
    ...CONTEXT,
    signal: new AbortController().signal,
  });
  expect(outcome).toEqual({ outcome: 'revoked' });
  expect(handler).toHaveBeenCalledWith(job, expect.objectContaining({ jobId: 'job-1' }));
  expect(() =>
    jobWorkers({
      db,
      config: testConfig(),
      logger: CONTEXT.logger,
      syncFor: undefined,
      register: (registry) => {
        registry.register('sweep', () => Promise.resolve({ outcome: 'again' }));
      },
    }),
  ).toThrow(HandlerRegisteredError);
});

test('the default concurrency is 4', async () => {
  expect((await wiring(undefined)).workers.concurrency).toBe(4);
});

test('the clock is the one given, and the wall clock when none is', async () => {
  const { db } = await migratedTestDatabase();
  const config = testConfig();
  const given = new FakeClock('2026-11-02T10:00:00Z');
  expect(jobWorkers({ db, config, logger: CONTEXT.logger, syncFor: undefined, clock: given }).clock).toBe(given);
  expect(
    Math.abs(jobWorkers({ db, config, logger: CONTEXT.logger, syncFor: undefined }).clock.now().getTime() - Date.now()),
  ).toBeLessThan(5000);
});

test('the delivery marker sets processed_at of the recorded delivery and of no other', async () => {
  const { db, workers } = await wiring(undefined);
  const deliveries = createWebhookDeliveries({ db, enqueuer: fakeEnqueuer() });
  await deliveries.record(
    { deliveryId: DELIVERY, event: 'installation', action: 'created' },
    { type: 'sync-installation', githubInstallationId: INSTALLATION, deliveryId: DELIVERY },
  );
  expect((await deliveryRows(db)).map((row) => row.processed_at)).toEqual([null]);
  await workers.markDeliveryProcessed(DELIVERY);
  expect((await deliveryRows(db)).map((row) => row.processed_at !== null)).toEqual([true]);
});

test('sync-installation syncs through the sync that is bound to the signal of the job', async () => {
  const syncInstallation = vi.fn<InstallationSync['syncInstallation']>(() => Promise.resolve(SYNCED));
  const unused = () => Promise.reject(new Error('not used by the handler'));
  const syncFor = vi.fn<NonNullable<InstallationWiring['syncFor']>>(() => ({
    syncInstallation,
    reconcileInstallations: unused,
    refreshRepositorySnapshot: unused,
  }));
  const { workers } = await wiring(syncFor);
  const signal = new AbortController().signal;
  const outcome = await workers.registry.run(
    'sync-installation',
    { type: 'sync-installation', githubInstallationId: INSTALLATION },
    { ...CONTEXT, signal },
  );
  expect(outcome).toEqual({ outcome: 'synced' });
  expect(syncFor).toHaveBeenCalledExactlyOnceWith(signal);
  expect(syncInstallation).toHaveBeenCalledExactlyOnceWith(INSTALLATION);
});

test('without a GitHub App the handler of sync-installation fails its jobs', async () => {
  const { workers } = await wiring(undefined);
  await expect(
    workers.registry.run(
      'sync-installation',
      { type: 'sync-installation', githubInstallationId: INSTALLATION },
      { ...CONTEXT, signal: new AbortController().signal },
    ),
  ).rejects.toBeInstanceOf(HandlerUnavailableError);
});

test('without an evaluation reporter the handler of evaluate-pr fails its jobs', async () => {
  const { workers } = await wiring(undefined);
  await expect(
    workers.registry.run('evaluate-pr', JOB, { ...CONTEXT, signal: new AbortController().signal }),
  ).rejects.toBeInstanceOf(HandlerUnavailableError);
});

async function evaluating(clock = new FakeClock('2026-11-02T10:00:00Z')) {
  const world = await evaluateWorld();
  const workers = jobWorkers({
    db: world.raw,
    config: testConfig(),
    logger: CONTEXT.logger,
    syncFor: undefined,
    evaluation: { github: world.fake, reporter: world.reporter },
    clock,
  });
  return { world, workers };
}

test('with GitHub and a reporter the handler of evaluate-pr evaluates the pull request with the engine of E08 and reports the verdict', async () => {
  const { world, workers } = await evaluating();
  const outcome = await workers.registry.run('evaluate-pr', JOB, { ...CONTEXT, signal: new AbortController().signal });
  expect(outcome).toEqual({ outcome: 'evaluated' });
  expect(world.reporter.published.map((report) => report.evaluation.outcome)).toEqual(['failure']);
  expect((await world.rows()).map((row) => row.result)).toEqual(['failure']);
});

test('every evaluation of the process reads and fills one memory of the membership lookups, on the clock of the process (E07-S10)', async () => {
  const clock = new FakeClock('2026-11-02T10:00:00Z');
  const { world, workers } = await evaluating(clock);
  await allow(world, { kind: 'org_members', githubId: ORG });
  for (const person of [7, 1, 2]) {
    enrol(world, person);
  }
  const evaluate = () => workers.registry.run('evaluate-pr', JOB, { ...CONTEXT, signal: new AbortController().signal });
  await evaluate();
  expect(lookups(world)).toBe(3);
  await evaluate();
  expect(lookups(world)).toBe(3);
  clock.advance(MEMBER_TTL_MS);
  await evaluate();
  expect(lookups(world)).toBe(6);
});

test('without an evaluation reporter the handler of close-pr fails its jobs', async () => {
  const { workers } = await wiring(undefined);
  await expect(
    workers.registry.run('close-pr', CLOSE_JOB, { ...CONTEXT, signal: new AbortController().signal }),
  ).rejects.toBeInstanceOf(HandlerUnavailableError);
});

test('with GitHub and a reporter the handler of close-pr cancels the evaluation in progress of the closed pull request and reports it', async () => {
  const { world, workers } = await evaluating();
  world.fake.addPullRequest(TENANT_INSTALLATION, FULL_NAME, pullRequest(PR_NUMBER, { state: 'closed' }));
  await seedEvaluation(world, { result: 'in_progress' });
  const outcome = await workers.registry.run('close-pr', CLOSE_JOB, {
    ...CONTEXT,
    signal: new AbortController().signal,
  });
  expect(outcome).toEqual({ outcome: 'closed' });
  expect(world.reporter.cancellations.map((target) => target.headSha)).toEqual([HEAD]);
  expect((await world.rows()).map((row) => row.result)).toEqual(['cancelled']);
});

test('the GitHub client of a close is bound to the signal of the job: an aborted job asks GitHub for nothing', async () => {
  const { world, workers } = await evaluating();
  const reason = new Error('the worker is shutting down');
  await expect(
    workers.registry.run('close-pr', CLOSE_JOB, { ...CONTEXT, signal: AbortSignal.abort(reason) }),
  ).rejects.toBe(reason);
  expect(world.calls()).toEqual([]);
});

test('the GitHub client of an evaluation is bound to the signal of the job: an aborted job asks GitHub for nothing', async () => {
  const { world, workers } = await evaluating();
  const controller = new AbortController();
  const reason = new Error('the worker is shutting down');
  controller.abort(reason);
  await expect(workers.registry.run('evaluate-pr', JOB, { ...CONTEXT, signal: controller.signal })).rejects.toBe(
    reason,
  );
  expect(world.calls()).toEqual([]);
});

test('the dead-letter handlers get the database, and no way to report while there is no GitHub App or no reporter (E07-S05)', async () => {
  const { db, workers } = await wiring(undefined);
  expect(workers.deadLetter?.db).toBe(db);
  expect(workers.deadLetter?.evaluation).toBeUndefined();
});

test('with GitHub and a reporter a dead evaluate-pr is failed through the reporter, with GitHub bound to the signal of the dead-letter job', async () => {
  const { world, workers } = await evaluating();
  expect(workers.deadLetter?.evaluation).toBeTypeOf('function');
  const registry = deadLetterRegistry(workers.deadLetter ?? { db: world.raw, evaluation: undefined }, workers.clock);
  const outcome = await registry.run('evaluate-pr', JOB, { ...CONTEXT, signal: new AbortController().signal });
  expect(outcome).toEqual({ outcome: 'reported' });
  expect(world.reporter.failures.map((failure) => failure.code)).toEqual(['evaluation_failed']);
  expect((await world.rows()).map((row) => row.result)).toEqual(['failure']);
});

test('an aborted dead-letter job asks GitHub for nothing', async () => {
  const { world, workers } = await evaluating();
  const registry = deadLetterRegistry(workers.deadLetter ?? { db: world.raw, evaluation: undefined }, workers.clock);
  const reason = new Error('the worker is shutting down');
  await expect(registry.run('evaluate-pr', JOB, { ...CONTEXT, signal: AbortSignal.abort(reason) })).rejects.toBe(
    reason,
  );
  expect(world.calls()).toEqual([]);
  expect(world.reporter.failures).toEqual([]);
});
