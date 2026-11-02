// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { GitHubRateLimitedError, GitHubUnavailableError } from '../ports/github-errors.ts';
import { type EvaluateWorld, evaluateWorld, INSTALLATION } from './test-support.ts';

// What a failure does to the job and its row (E07-S04): the queue retries the job, and the retry leaves one row and one
// verdict, however far the first run got.

const OUTAGE = new GitHubUnavailableError('GitHub answered 500');

/** Fails the second read of the pull request (step 8) of the first run: the failure is armed when the reporter is told the evaluation began. */
function failStepEight(world: EvaluateWorld): void {
  let armed = false;
  world.reporter.hooks.started = () => {
    if (!armed) {
      armed = true;
      world.fake.failNext('getPullRequest', OUTAGE);
    }
    return Promise.resolve();
  };
}

test.each([
  [
    '1, the repository',
    (world: EvaluateWorld) => {
      world.fake.failNext('getRepositoryById', OUTAGE);
    },
    0,
    0,
  ],
  [
    '2, the pull request',
    (world: EvaluateWorld) => {
      world.fake.failNext('getPullRequest', OUTAGE);
    },
    0,
    0,
  ],
  [
    '4, the commits',
    (world: EvaluateWorld) => {
      world.fake.failNext('listPullRequestCommits', OUTAGE);
    },
    1,
    1,
  ],
  ['8, the pull request again', failStepEight, 1, 1],
])(
  'an outage of GitHub at step %s fails the job, and its retry leaves one row and one verdict',
  async (_step, inject, started, rowsAfterFailure) => {
    const world = await evaluateWorld();
    inject(world);
    await expect(world.run()).rejects.toBe(OUTAGE);
    expect(world.reporter.startedTargets).toHaveLength(started);
    expect(await world.rows()).toHaveLength(rowsAfterFailure);
    expect(world.reporter.published).toEqual([]);
    expect(await world.run(undefined, { attempt: 1 })).toEqual({ outcome: 'evaluated' });
    expect(world.reporter.published).toHaveLength(1);
    expect((await world.rows()).map((row) => row.result)).toEqual(['success']);
  },
);

test('a retry after a failure at step 8 updates the row of the first run: the engine ran twice, one verdict was reported, one row exists', async () => {
  const world = await evaluateWorld();
  failStepEight(world);
  await expect(world.run()).rejects.toBe(OUTAGE);
  const [first] = await world.rows();
  await world.run(undefined, { attempt: 1 });
  const rows = await world.rows();
  expect(rows.map((row) => row.id)).toEqual([first?.id]);
  expect(world.evaluate).toHaveBeenCalledTimes(2);
  expect(world.reporter.published).toHaveLength(1);
});

/** A reporter whose publish fails once, after the verdict was stored. */
function failPublishOnce(world: EvaluateWorld): void {
  let remaining = 1;
  world.reporter.hooks.publish = () => {
    remaining -= 1;
    return remaining < 0 ? Promise.resolve() : Promise.reject(new Error('the reporter is down'));
  };
}

test('a reporter that fails after the verdict was stored fails the job, and the retry evaluates again, publishes once more, and leaves one row', async () => {
  const world = await evaluateWorld();
  failPublishOnce(world);
  await expect(world.run()).rejects.toThrow('the reporter is down');
  expect((await world.rows()).map((row) => row.result)).toEqual(['success']);
  expect(world.reporter.published).toHaveLength(1);
  expect(await world.run(undefined, { attempt: 1 })).toEqual({ outcome: 'evaluated' });
  expect(world.reporter.published).toHaveLength(2);
  expect(await world.rows()).toHaveLength(1);
});

test('a reporter that fails at the start fails the job before any commit is read', async () => {
  const world = await evaluateWorld();
  world.reporter.hooks.started = () => Promise.reject(new Error('the reporter is down'));
  await expect(world.run()).rejects.toThrow('the reporter is down');
  expect(world.calls()).not.toContain('listPullRequestCommits');
  expect(world.evaluate).not.toHaveBeenCalled();
});

test('a rate limit is rethrown as it is: the queue decides when to try again', async () => {
  const world = await evaluateWorld();
  const limited = new GitHubRateLimitedError(30, 'primary');
  world.fake.failNext('getPullRequest', limited);
  await expect(world.run()).rejects.toBe(limited);
  expect(await world.rows()).toEqual([]);
});

test('an installation that GitHub no longer serves ends the job as skipped, without a retry', async () => {
  const world = await evaluateWorld();
  world.fake.removeInstallation(INSTALLATION);
  expect(await world.run()).toEqual({ outcome: 'skipped:installation_unavailable' });
  expect(await world.rows()).toEqual([]);
});

test('a suspended installation ends the job as skipped', async () => {
  const world = await evaluateWorld();
  world.fake.suspend(INSTALLATION, new Date('2026-11-01T00:00:00Z'));
  expect(await world.run()).toEqual({ outcome: 'skipped:installation_unavailable' });
});

test('an installation the gate refuses ends the job as skipped', async () => {
  const world = await evaluateWorld();
  world.gate.refuse(INSTALLATION, 'rejected');
  expect(await world.run()).toEqual({ outcome: 'skipped:installation_unavailable' });
  expect(world.calls()).toEqual([]);
});

test('a failure of the database is not swallowed: the job fails with it', async () => {
  const world = await evaluateWorld();
  await world.raw.schema.dropTable('pr_evaluations').cascade().execute();
  await expect(world.run()).rejects.toThrow();
});
