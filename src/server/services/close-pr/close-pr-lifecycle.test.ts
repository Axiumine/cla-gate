// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { pullRequest } from '../github-pull-contract/test-support.ts';
import { closeWorld, FULL_NAME, HEAD, INSTALLATION, PR_NUMBER, resultsOf, seedEvaluation } from './test-support.ts';

// A close meets the evaluation job at both ends (E07-S06): an evaluation that is running when the pull request is closed ends
// itself, and a pull request that is reopened is evaluated again from the row the close left.

const OPEN = pullRequest(PR_NUMBER);
const CLOSED = pullRequest(PR_NUMBER, { state: 'closed' });

test('a running evaluation is not interrupted: it finishes as superseded, after the close cancelled its row and its Check Run', async () => {
  const world = await closeWorld();
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, OPEN);
  world.reporter.hooks.started = async () => {
    world.fake.addPullRequest(INSTALLATION, FULL_NAME, CLOSED);
    expect(await world.runClose()).toEqual({ outcome: 'closed' });
  };
  expect(await world.run()).toEqual({ outcome: 'superseded' });
  expect(await resultsOf(world)).toEqual([[PR_NUMBER, HEAD, 'cancelled']]);
  expect(world.reporter.cancellations.map((target) => target.headSha)).toEqual([HEAD]);
  expect(world.reporter.published).toEqual([]);
  expect(world.evaluate).toHaveBeenCalledOnce();
});

test('a close after a reopen leaves the evaluation of the reopen alone', async () => {
  const world = await closeWorld();
  await seedEvaluation(world, { result: 'in_progress' });
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, OPEN);
  expect(await world.runClose()).toEqual({ outcome: 'skipped:pull_request_open' });
  expect(await world.run()).toEqual({ outcome: 'evaluated' });
  expect(await resultsOf(world)).toEqual([[PR_NUMBER, HEAD, 'success']]);
  expect(world.reporter.cancellations).toEqual([]);
});

test('a close followed by a reopen: the cancelled row is evaluated again, keeps its identity and ends success', async () => {
  const world = await closeWorld();
  const id = await seedEvaluation(world, { result: 'in_progress' });
  await world.runClose();
  expect(await resultsOf(world)).toEqual([[PR_NUMBER, HEAD, 'cancelled']]);
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, OPEN);
  expect(await world.run()).toEqual({ outcome: 'evaluated' });
  expect((await world.rows()).map((row) => [row.id, row.result])).toEqual([[id, 'success']]);
  expect(world.reporter.startedTargets.map((target) => target.evaluationId)).toEqual([id]);
  expect(world.reporter.published).toHaveLength(1);
});

test('a cancelled row that a Check Run was written for is evaluated again on the next pull_request delivery, not answered by what is stored', async () => {
  const world = await closeWorld();
  await seedEvaluation(world, { result: 'in_progress', checkRunId: 55 });
  await world.runClose();
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, OPEN);
  expect(await world.run()).toEqual({ outcome: 'evaluated' });
  expect(world.evaluate).toHaveBeenCalledOnce();
  expect((await world.rows()).map((row) => [row.result, row.check_run_id])).toEqual([['success', 55]]);
});

test('a reopened pull request whose contributors have not signed ends failure from the cancelled row', async () => {
  const world = await closeWorld({ engine: true });
  await seedEvaluation(world, { result: 'in_progress' });
  await world.runClose();
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, OPEN);
  expect(await world.run()).toEqual({ outcome: 'evaluated' });
  expect(await resultsOf(world)).toEqual([[PR_NUMBER, HEAD, 'failure']]);
  expect(world.reporter.published.map((report) => report.evaluation.outcome)).toEqual(['failure']);
});
