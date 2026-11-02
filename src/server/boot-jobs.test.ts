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
import { evaluateWorld, JOB } from './services/evaluate-pr/test-support.ts';
import type { InstallationSync } from './services/installation-sync.ts';
import { HandlerUnavailableError } from './services/job-handlers.ts';
import { createJobsTable, deliveryRows, fakeEnqueuer } from './services/jobs-fixture/test-support.ts';
import { FakeClock } from './services/test-support.ts';
import { createWebhookDeliveries } from './services/webhook-deliveries.ts';
import { testConfig } from './test-support.ts';

// What boot hands the job workers (E07-S03): the registry with its handlers, the delivery marker on the database, the
// clock and the concurrency of the configuration.

const DELIVERY = deliveryIdSchema.parse('5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c');
const INSTALLATION = parseGithubId(31_001);
const SYNCED = { status: 'synced', changed: true, repositories: { added: 0, renamed: 0, removed: 0 } } as const;
const CONTEXT = { jobId: 'job-1', attempt: 0, logger: createLogger({ logLevel: 'silent' }) };

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

test('the registry binds the seven handlers of the application, and the concurrency is the one of the configuration', async () => {
  const { workers } = await wiring(undefined, { WORKER_CONCURRENCY: '7' });
  expect(workers.registry.types()).toEqual(JOB_TYPES.filter((type) => type !== 'revoke-user-sessions'));
  expect(workers.concurrency).toBe(7);
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

async function evaluating() {
  const world = await evaluateWorld();
  const workers = jobWorkers({
    db: world.raw,
    config: testConfig(),
    logger: CONTEXT.logger,
    syncFor: undefined,
    evaluation: { github: world.fake, reporter: world.reporter },
    clock: new FakeClock('2026-11-02T10:00:00Z'),
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
