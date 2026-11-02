// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { createLogger } from './adapters/http/logger.ts';
import type { InstallationWiring } from './boot-installations.ts';
import { jobWorkers } from './boot-jobs.ts';
import { HandlerUnavailableError } from './services/job-handlers.ts';
import { FakePendingJobs } from './services/job-run-fixture/test-support.ts';
import { PR_NUMBER, REPOSITORY, SWEEP_JOB, sweepWorld } from './services/sweep/test-support.ts';
import { FakeClock } from './services/test-support.ts';
import { testConfig } from './test-support.ts';

// What boot wires for the scheduled sweep (E07-S08): the two handlers, and whether the schedule is set at all.

const LOGGER = createLogger({ logLevel: 'silent' });

function syncDouble() {
  const unused = () => Promise.reject(new Error('not used by the sweep'));
  const reconcileInstallations = vi.fn<() => Promise<{ synced: number; failed: number }>>(() =>
    Promise.resolve({ synced: 1, failed: 0 }),
  );
  const syncFor = vi.fn<NonNullable<InstallationWiring['syncFor']>>(() => ({
    syncInstallation: unused,
    reconcileInstallations,
    refreshRepositorySnapshot: unused,
  }));
  return { syncFor, reconcileInstallations };
}

async function workersOf(options: { sync: boolean; evaluating: boolean; env?: Record<string, string> }) {
  const world = await sweepWorld();
  const { syncFor, reconcileInstallations } = syncDouble();
  const workers = jobWorkers({
    db: world.raw,
    config: testConfig(options.env ?? {}),
    logger: LOGGER,
    syncFor: options.sync ? syncFor : undefined,
    evaluation: options.evaluating ? { github: world.fake, reporter: world.reporter } : undefined,
    clock: new FakeClock('2026-11-02T10:00:00Z'),
  });
  return { world, workers, syncFor, reconcileInstallations };
}

test.each([
  ['the default', {}, 30],
  ['10 minutes', { SWEEP_INTERVAL_MINUTES: '10' }, 10],
  ['an interval of 0, which turns the sweep off', { SWEEP_INTERVAL_MINUTES: '0' }, 0],
] as const)('with GitHub and a reporter the sweep is scheduled at %s', async (_name, env, minutes) => {
  const { workers } = await workersOf({ sync: true, evaluating: true, env });
  expect(workers.sweepIntervalMinutes).toBe(minutes);
});

test.each([
  ['no GitHub App', false, false],
  ['a GitHub App and no reporter', true, false],
  ['a reporter and no sync', false, true],
] as const)('with %s the sweep is not scheduled: its jobs could not run', async (_name, sync, evaluating) => {
  const { workers } = await workersOf({ sync, evaluating });
  expect(workers.sweepIntervalMinutes).toBe(0);
});

test('sweep reconciles through the sync that is bound to the signal of the job, and sends a job for each served installation', async () => {
  const { world, workers, syncFor, reconcileInstallations } = await workersOf({ sync: true, evaluating: true });
  const signal = new AbortController().signal;
  const outcome = await workers.registry.run(
    'sweep',
    { type: 'sweep' },
    { jobId: 'job-1', attempt: 0, logger: LOGGER, pending: new FakePendingJobs(), enqueuer: world.enqueuer, signal },
  );
  expect(outcome).toEqual({ outcome: 'fanned_out' });
  expect(syncFor).toHaveBeenCalledExactlyOnceWith(signal);
  expect(reconcileInstallations).toHaveBeenCalledOnce();
  expect((await world.queued()).map(({ job }) => job.type)).toEqual(['sweep-installation']);
});

test('without a GitHub App the handler of sweep fails its jobs', async () => {
  const { world, workers } = await workersOf({ sync: false, evaluating: true });
  await expect(
    workers.registry.run(
      'sweep',
      { type: 'sweep' },
      {
        jobId: 'job-1',
        attempt: 0,
        logger: LOGGER,
        pending: new FakePendingJobs(),
        enqueuer: world.enqueuer,
        signal: new AbortController().signal,
      },
    ),
  ).rejects.toBeInstanceOf(HandlerUnavailableError);
});

test('without an evaluation reporter the handler of sweep-installation fails its jobs', async () => {
  const { world, workers } = await workersOf({ sync: true, evaluating: false });
  await expect(
    workers.registry.run('sweep-installation', SWEEP_JOB, {
      jobId: 'job-1',
      attempt: 0,
      logger: LOGGER,
      pending: new FakePendingJobs(),
      enqueuer: world.enqueuer,
      signal: new AbortController().signal,
    }),
  ).rejects.toBeInstanceOf(HandlerUnavailableError);
});

test('with GitHub and a reporter sweep-installation queues the evaluation of the pull request that missed its delivery', async () => {
  const { world, workers } = await workersOf({ sync: true, evaluating: true });
  const outcome = await workers.registry.run('sweep-installation', SWEEP_JOB, {
    jobId: 'job-2',
    attempt: 0,
    logger: LOGGER,
    pending: new FakePendingJobs(),
    enqueuer: world.enqueuer,
    signal: new AbortController().signal,
  });
  expect(outcome).toEqual({ outcome: 'swept' });
  expect((await world.queued()).map(({ idempotencyKey, job }) => [idempotencyKey, job.type])).toEqual([
    [`sweep:job-2:${String(REPOSITORY)}:${String(PR_NUMBER)}`, 'evaluate-pr'],
  ]);
});

test('the GitHub client of a sweep is bound to the signal of the job: an aborted job asks GitHub for nothing', async () => {
  const { world, workers } = await workersOf({ sync: true, evaluating: true });
  const reason = new Error('the worker is shutting down');
  await expect(
    workers.registry.run('sweep-installation', SWEEP_JOB, {
      jobId: 'job-3',
      attempt: 0,
      logger: LOGGER,
      pending: new FakePendingJobs(),
      enqueuer: world.enqueuer,
      signal: AbortSignal.abort(reason),
    }),
  ).rejects.toBe(reason);
  expect(world.fake.calls).toEqual([]);
});
