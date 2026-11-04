// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { seedTenant } from '../../adapters/db/test-support.ts';
import { type EvaluateWorld, evaluateWorld, INSTALLATION, PR_NUMBER, REPOSITORY } from './test-support.ts';

// Enforcement turned off while an evaluation is running (E14-S04): the evaluation reads whether the repository still enforces
// before it writes the Check Run and the comment, and again after, and in both cases hands the pull request to a
// `finalise-check` job sent after that read.

const FINALISE = {
  type: 'finalise-check',
  githubInstallationId: INSTALLATION,
  githubRepoId: REPOSITORY,
  prNumber: PR_NUMBER,
} as const;

/** Turns enforcement off for the repository, as the disable route commits it. */
async function switchOff(world: EvaluateWorld): Promise<void> {
  await world.raw.updateTable('repositories').set({ enabled: false }).execute();
}

test('enforcement turned off before the write: the evaluation writes neither the Check Run nor the comment and hands the pull request over', async () => {
  const world = await evaluateWorld();
  world.reporter.hooks.started = () => switchOff(world);
  expect(await world.run()).toEqual({ outcome: 'skipped:repository_disabled' });
  expect(world.reporter.published).toEqual([]);
  expect(world.reporter.failures).toEqual([]);
  expect(world.timeline).not.toContain('reporter.publish');
  expect(world.handedOver.sent).toEqual([
    { job: FINALISE, options: { idempotencyKey: 'finalise-check:evaluate-pr:job-1:0' } },
  ]);
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'evaluate_pr.skipped', reason: 'repository_disabled' }),
  );
});

test('the stored verdict stays: the write that is skipped is the report on GitHub, not the row, and nothing is rolled back', async () => {
  const world = await evaluateWorld();
  world.reporter.hooks.started = () => switchOff(world);
  await world.run();
  expect((await world.rows()).map((row) => row.result)).toEqual(['success']);
});

test('the hand-over before the write names the run and the attempt, so each attempt of a job sends its own', async () => {
  const world = await evaluateWorld();
  world.reporter.hooks.started = () => switchOff(world);
  await world.run(undefined, { attempt: 3, jobId: 'job-8' });
  expect(world.handedOver.sent.map((sent) => sent.options.idempotencyKey)).toEqual([
    'finalise-check:evaluate-pr:job-8:3',
  ]);
});

test('a repository that is off when the job starts is skipped as before: nothing is started, written or handed over', async () => {
  const world = await evaluateWorld();
  await switchOff(world);
  expect(await world.run()).toEqual({ outcome: 'skipped:repository_disabled' });
  expect(world.reporter.startedTargets).toEqual([]);
  expect(world.handedOver.sent).toEqual([]);
  expect(await world.rows()).toEqual([]);
});

test('enforcement turned off after the write: the report was made, and the pull request is handed over so that the last write is the neutral one', async () => {
  const world = await evaluateWorld();
  world.reporter.hooks.publish = () => switchOff(world);
  expect(await world.run(undefined, { attempt: 2, jobId: 'job-5' })).toEqual({ outcome: 'evaluated' });
  expect(world.reporter.published).toHaveLength(1);
  expect(world.handedOver.sent).toEqual([
    { job: FINALISE, options: { idempotencyKey: 'finalise-check:evaluate-pr:job-5:2' } },
  ]);
});

test('enforcement on throughout: the report is written and nothing is handed over', async () => {
  const world = await evaluateWorld();
  expect(await world.run()).toEqual({ outcome: 'evaluated' });
  expect(world.reporter.published).toHaveLength(1);
  expect(world.handedOver.sent).toEqual([]);
});

test('a hand-over that cannot be sent fails the job, before the write and after it, so the queue retries it', async () => {
  const before = await evaluateWorld();
  before.reporter.hooks.started = () => switchOff(before);
  before.handedOver.failure = new Error('the queue is down');
  await expect(before.run()).rejects.toThrow('the queue is down');
  expect(before.reporter.published).toEqual([]);
  const after = await evaluateWorld();
  after.reporter.hooks.publish = () => switchOff(after);
  after.handedOver.failure = new Error('the queue is down');
  await expect(after.run()).rejects.toThrow('the queue is down');
  expect(after.reporter.published).toHaveLength(1);
});

test('a repository of another tenant that is switched off does not stop the evaluation of this one', async () => {
  const world = await evaluateWorld();
  const other = await seedTenant(world.raw, 2);
  await world.raw.updateTable('repositories').set({ enabled: false }).where('id', '=', other.repositoryId).execute();
  expect(await world.run()).toEqual({ outcome: 'evaluated' });
  expect(world.handedOver.sent).toEqual([]);
});
