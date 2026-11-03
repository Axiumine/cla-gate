// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { GitHubRateLimitedError, GitHubUnavailableError } from '../ports/github-errors.ts';
import { type CloseWorld, closeWorld, HEAD, PR_NUMBER, resultsOf, seedEvaluation } from './test-support.ts';

// What a failure does to the job (E07-S06): the queue retries it, and the retry finishes the work wherever the first run
// stopped. The order of the steps is what makes that so: the jobs are cancelled first, and for each row the report comes
// before the write, so a row that is not `cancelled` is a row whose Check Run may still hang.

const OUTAGE = new GitHubUnavailableError('GitHub answered 500');

async function inProgress(): Promise<CloseWorld> {
  const world = await closeWorld();
  await seedEvaluation(world, { result: 'in_progress' });
  return world;
}

test.each([
  [
    'the repository',
    (world: CloseWorld) => {
      world.fake.failNext('getRepositoryById', OUTAGE);
    },
  ],
  [
    'the pull request',
    (world: CloseWorld) => {
      world.fake.failNext('getPullRequest', OUTAGE);
    },
  ],
])(
  'an outage of GitHub when it is asked for %s fails the job with nothing done, and the retry finishes',
  async (_what, inject) => {
    const world = await inProgress();
    inject(world);
    await expect(world.runClose()).rejects.toBe(OUTAGE);
    expect(world.pending.targets).toEqual([]);
    expect(world.reporter.cancellations).toEqual([]);
    expect(await resultsOf(world)).toEqual([[PR_NUMBER, HEAD, 'in_progress']]);
    expect(await world.runClose()).toEqual({ outcome: 'closed' });
    expect(await resultsOf(world)).toEqual([[PR_NUMBER, HEAD, 'cancelled']]);
  },
);

test('a rate limit is rethrown as it is: the queue decides when to try again', async () => {
  const world = await inProgress();
  const limited = new GitHubRateLimitedError(30, 'primary');
  world.fake.failNext('getPullRequest', limited);
  await expect(world.runClose()).rejects.toBe(limited);
});

test('a queue that cannot cancel fails the job before any row or report is touched, and the retry finishes', async () => {
  const world = await inProgress();
  const down = new Error('the queue is down');
  world.pending.behaviour = () => Promise.reject(down);
  await expect(world.runClose()).rejects.toBe(down);
  expect(world.reporter.cancellations).toEqual([]);
  expect(await resultsOf(world)).toEqual([[PR_NUMBER, HEAD, 'in_progress']]);
  world.pending.behaviour = undefined;
  expect(await world.runClose()).toEqual({ outcome: 'closed' });
  expect(await resultsOf(world)).toEqual([[PR_NUMBER, HEAD, 'cancelled']]);
});

test('a reporter that fails leaves the row in progress, so the retry reports the Check Run again and ends it', async () => {
  const world = await inProgress();
  world.reporter.hooks.cancelled = () => Promise.reject(new Error('the reporter is down'));
  await expect(world.runClose()).rejects.toThrow('the reporter is down');
  expect(await resultsOf(world)).toEqual([[PR_NUMBER, HEAD, 'in_progress']]);
  world.reporter.hooks.cancelled = undefined;
  expect(await world.runClose()).toEqual({ outcome: 'closed' });
  expect(await resultsOf(world)).toEqual([[PR_NUMBER, HEAD, 'cancelled']]);
  expect(world.reporter.cancellations.map((target) => target.headSha)).toEqual([HEAD, HEAD]);
});

test('a reporter that fails on the second of two rows leaves that one in progress and the first one cancelled', async () => {
  const world = await closeWorld();
  await seedEvaluation(world, { result: 'in_progress', headSha: 'b'.repeat(40) });
  await seedEvaluation(world, { result: 'in_progress', headSha: HEAD });
  world.reporter.hooks.cancelled = (target) =>
    target.headSha === HEAD ? Promise.reject(new Error('the reporter is down')) : Promise.resolve();
  await expect(world.runClose()).rejects.toThrow('the reporter is down');
  expect(await resultsOf(world)).toEqual([
    [PR_NUMBER, 'b'.repeat(40), 'cancelled'],
    [PR_NUMBER, HEAD, 'in_progress'],
  ]);
});
