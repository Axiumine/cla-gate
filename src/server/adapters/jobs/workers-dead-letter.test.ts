// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, onTestFinished, test } from 'vitest';
import { completing, JOBS, runWorld } from '../../services/job-run-fixture/test-support.ts';
import { openPgliteDatabase } from '../db/pglite.ts';
import type { WorkerJob } from './boss.ts';
import { fakeBoss } from './test-support.ts';
import { Workers } from './workers.ts';

// The worker of the dead-letter queue (E07-S05), with a pg-boss that is only a script. Against a real server:
// dead-letter-real.test.ts.

async function world(deadLetter: boolean) {
  const run = runWorld((registry) => {
    registry.register('sync-installation', completing());
  });
  const db = await openPgliteDatabase();
  onTestFinished(async () => {
    await db.destroy();
  });
  const workers = new Workers({
    ...run.deps,
    concurrency: 3,
    pollingIntervalSeconds: 0.5,
    ...(deadLetter ? { deadLetter: { db, evaluation: undefined } } : {}),
  });
  return { ...run, workers, boss: fakeBoss() };
}

const job = (data: object, overrides: Partial<WorkerJob> = {}): WorkerJob => ({
  id: 'dead-1',
  data,
  retryCount: 0,
  signal: new AbortController().signal,
  ...overrides,
});

function deadWorker(boss: ReturnType<typeof fakeBoss>) {
  const call = boss.work.mock.calls.find(([name]) => name === 'job-dead-letter');
  if (call === undefined) {
    throw new Error('the dead-letter queue is not worked');
  }
  return { options: call[1], handler: call[2] };
}

test('with the ports of the dead-letter handlers the dead-letter queue is worked like the others: same concurrency, one job per fetch', async () => {
  const { workers, boss } = await world(true);
  await workers.start(boss);
  expect(boss.work.mock.calls.map(([name]) => name)).toEqual(['sync-installation', 'job-dead-letter']);
  expect(deadWorker(boss).options).toEqual({
    localConcurrency: 3,
    batchSize: 1,
    perJobResults: true,
    pollingIntervalSeconds: 0.5,
  });
});

test('without those ports the dead-letter queue has no worker and keeps what the others gave up', async () => {
  const { workers, boss } = await world(false);
  await workers.start(boss);
  expect(boss.work.mock.calls.map(([name]) => name)).toEqual(['sync-installation']);
});

test('a dead job is settled completed with the outcome of the handler of its type, under its own id', async () => {
  const { workers, boss, marked } = await world(true);
  await workers.start(boss);
  const results = await deadWorker(boss).handler([job(JOBS.closePr, { id: 'dead-42' })]);
  expect(results).toEqual([{ id: 'dead-42', status: 'completed', output: { outcome: 'logged' } }]);
  expect(marked).toEqual([]);
});

test('a dead-letter handler that throws makes the worker reject, so pg-boss retries the dead-letter job', async () => {
  const { workers, boss } = await world(true);
  await workers.start(boss);
  await expect(deadWorker(boss).handler([job(JOBS.evaluatePr)])).rejects.toThrow('no GitHub App');
});

test('a dead job that the shutdown aborts is counted like any other aborted job', async () => {
  const abort = new AbortController();
  const { workers, boss } = await world(true);
  await workers.start(boss);
  workers.beginStop();
  abort.abort(new Error('grace period over'));
  await expect(deadWorker(boss).handler([job(JOBS.closePr, { signal: abort.signal })])).rejects.toThrow(
    'grace period over',
  );
  expect(workers.outcome()).toBe('aborted');
});
