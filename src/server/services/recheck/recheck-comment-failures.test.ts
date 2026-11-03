// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { failingAfterSend, jobCount, switchableEnqueuer } from '../jobs-fixture/test-support.ts';
import { GitHubRateLimitedError, GitHubUnavailableError } from '../ports/github-errors.ts';
import { recheckWorld } from './test-support.ts';

// What a failure does to the `recheck-comment` job (E07-S07): the queue retries it, and the retry sends the evaluation once.

const OUTAGE = new GitHubUnavailableError('GitHub answered 500');

test.each(['getRepositoryById', 'getIssueComment', 'getPullRequest'] as const)(
  'an outage of GitHub at %s fails the job with nothing sent, and the retry sends the evaluation',
  async (method) => {
    const world = await recheckWorld();
    world.fake.failNext(method, OUTAGE);
    await expect(world.runComment()).rejects.toBe(OUTAGE);
    expect(await jobCount(world.raw)).toBe(0);
    expect(await world.runComment()).toEqual({ outcome: 'enqueued' });
    expect(await jobCount(world.raw)).toBe(1);
  },
);

test('a rate limit is rethrown as it is: the queue decides when to try again, and no worker waits for GitHub', async () => {
  const world = await recheckWorld();
  const limited = new GitHubRateLimitedError(30, 'primary');
  world.fake.failNext('getIssueComment', limited);
  await expect(world.runComment()).rejects.toBe(limited);
  expect(await jobCount(world.raw)).toBe(0);
});

test('a queue that fails after the send rolls the evaluation back, fails the job, and the retry sends it once', async () => {
  const world = await recheckWorld();
  const queue = switchableEnqueuer(world.enqueuer);
  const down = new Error('the queue lost its connection');
  queue.failWith(down);
  await expect(world.runComment(undefined, queue)).rejects.toBe(down);
  expect(await jobCount(world.raw)).toBe(0);
  queue.failWith(undefined);
  expect(await world.runComment(undefined, queue)).toEqual({ outcome: 'enqueued' });
  expect(await jobCount(world.raw)).toBe(1);
});

test('a queue that is down for good keeps failing the job instead of completing it with nothing sent', async () => {
  const world = await recheckWorld();
  const queue = failingAfterSend(world.enqueuer, new Error('no queue'));
  await expect(world.runComment(undefined, queue)).rejects.toThrow('no queue');
  await expect(world.runComment(undefined, queue)).rejects.toThrow('no queue');
  expect(await jobCount(world.raw)).toBe(0);
});
