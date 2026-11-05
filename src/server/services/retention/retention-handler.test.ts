// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { runJob } from '../job-run.ts';
import { queuedJob, runWorld } from '../job-run-fixture/test-support.ts';
import { retentionSweepHandler } from './retention-handler.ts';
import { at, DAY, deliveryIds, insertDelivery, insertSession, retentionWorld, sessionIds } from './test-support.ts';

// The consumer of the retention-sweep job (E22-S04), run the way a worker runs it: through the wrapper that validates the data,
// logs the job and settles it.

const JOB = { type: 'retention-sweep' } as const;

async function scene() {
  const world = await retentionWorld();
  const run = runWorld((registry) => {
    registry.register('retention-sweep', retentionSweepHandler(world.deps));
  });
  return { world, run };
}

test('a job that deleted something completes as swept, and logs the two counts and nothing else', async () => {
  const { world, run } = await scene();
  await insertDelivery(world.db, 'zzzz-old-delivery', at(-31 * DAY));
  await insertSession(world, 1, at(-2 * DAY));
  expect(await runJob('retention-sweep', queuedJob(JOB), run.deps)).toEqual({
    status: 'completed',
    output: { outcome: 'swept' },
  });
  const swept = run.logs.lines().filter((line) => line['msg'] === 'retention.swept');
  expect(swept).toEqual([expect.objectContaining({ webhook_deliveries: 1, sessions: 1, level: 30 })]);
  expect(run.logs.text()).not.toContain('zzzz');
  expect(await deliveryIds(world.db)).toEqual([]);
  expect(await sessionIds(world.db)).toEqual([]);
});

test('a job that found nothing due completes as nothing_due and logs zero counts', async () => {
  const { world, run } = await scene();
  await insertDelivery(world.db, 'recent', at(-DAY));
  expect(await runJob('retention-sweep', queuedJob(JOB), run.deps)).toEqual({
    status: 'completed',
    output: { outcome: 'nothing_due' },
  });
  expect(run.logs.lines().filter((line) => line['msg'] === 'retention.swept')).toEqual([
    expect.objectContaining({ webhook_deliveries: 0, sessions: 0 }),
  ]);
});

test('the job has no delivery, so no delivery is marked processed', async () => {
  const { run } = await scene();
  await runJob('retention-sweep', queuedJob(JOB), run.deps);
  expect(run.marked).toEqual([]);
});

test('the signal of the job stops the sweep: a job aborted at the shutdown deletes nothing and is not completed', async () => {
  const { world, run } = await scene();
  await insertDelivery(world.db, 'old', at(-31 * DAY));
  const controller = new AbortController();
  controller.abort(new Error('shutdown'));
  await expect(runJob('retention-sweep', queuedJob(JOB, { signal: controller.signal }), run.deps)).rejects.toThrow(
    'shutdown',
  );
  expect(await deliveryIds(world.db)).toEqual(['old']);
});

test.each([
  ['a field the job does not declare', { type: 'retention-sweep', days: 0 }],
  ['an installation', { type: 'retention-sweep', githubInstallationId: 5000 }],
  ['the type of another job', { type: 'sweep' }],
])('data with %s is dead-lettered before the sweep runs', async (_label, data) => {
  const { world, run } = await scene();
  await insertDelivery(world.db, 'old', at(-31 * DAY));
  expect((await runJob('retention-sweep', queuedJob(data), run.deps)).status).toBe('deadletter');
  expect(await deliveryIds(world.db)).toEqual(['old']);
});
