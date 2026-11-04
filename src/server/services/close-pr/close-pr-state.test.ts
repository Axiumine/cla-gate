// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { commitSha, pullRequest } from '../github-pull-contract/test-support.ts';
import {
  CLOSE_JOB,
  closeWorld,
  FULL_NAME,
  HEAD,
  INSTALLATION,
  PR_NUMBER,
  seedEvaluation,
  statesOf,
  touchedOf,
} from './test-support.ts';

// The state a close leaves in the evaluation rows (E15-S01): every row of the pull request is `closed`, whatever its result and
// head SHA, in one statement that does not touch `updated_at` (which decides the latest row of a pull request), and no other
// pull request is touched. The tenancy of it is in close-pr-tenancy.test.ts.

const OLDER = commitSha(3);
const OTHER_PR = 8;

test('a close marks every row of the pull request closed, each head SHA and each result, and the rows of another pull request stay open', async () => {
  const world = await closeWorld();
  await seedEvaluation(world, { result: 'success', headSha: OLDER });
  await seedEvaluation(world, { result: 'failure', headSha: commitSha(4) });
  await seedEvaluation(world, { result: 'in_progress' });
  await seedEvaluation(world, { result: 'success', prNumber: OTHER_PR });
  expect(await world.runClose()).toEqual({ outcome: 'closed' });
  expect(await statesOf(world)).toEqual([
    [PR_NUMBER, OLDER, 'closed'],
    [PR_NUMBER, commitSha(4), 'closed'],
    [PR_NUMBER, HEAD, 'closed'],
    [OTHER_PR, HEAD, 'open'],
  ]);
});

test('the close does not touch updated_at: the order of the rows of a pull request is what it was', async () => {
  const world = await closeWorld();
  await seedEvaluation(world, { result: 'success', headSha: OLDER });
  await seedEvaluation(world, { result: 'failure' });
  const before = await touchedOf(world);
  await world.runClose();
  expect(await touchedOf(world)).toEqual(before);
});

test('a pull request GitHub no longer shows is closed all the same: its rows are marked closed', async () => {
  const world = await closeWorld();
  await seedEvaluation(world, { result: 'success', prNumber: OTHER_PR });
  expect(await world.runClose({ ...CLOSE_JOB, prNumber: OTHER_PR })).toEqual({ outcome: 'closed' });
  expect(await statesOf(world)).toEqual([[OTHER_PR, HEAD, 'closed']]);
});

test('a pull request that was reopened before the job ran keeps its rows open: the close that is read from GitHub is not one', async () => {
  const world = await closeWorld();
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(PR_NUMBER, { state: 'open' }));
  await seedEvaluation(world, { result: 'success' });
  expect(await world.runClose()).toEqual({ outcome: 'skipped:pull_request_open' });
  expect(await statesOf(world)).toEqual([[PR_NUMBER, HEAD, 'open']]);
});

test('a close that fails after the rows were marked leaves them closed, and the retry finishes the work', async () => {
  const world = await closeWorld();
  await seedEvaluation(world, { result: 'in_progress' });
  const down = new Error('the reporter is down');
  world.reporter.hooks.cancelled = () => Promise.reject(down);
  await expect(world.runClose()).rejects.toBe(down);
  expect(await statesOf(world)).toEqual([[PR_NUMBER, HEAD, 'closed']]);
  world.reporter.hooks.cancelled = undefined;
  expect(await world.runClose()).toEqual({ outcome: 'closed' });
  expect(world.reporter.cancellations).toHaveLength(2);
});
