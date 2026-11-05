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
  REPOSITORY,
  resultsOf,
  seedEvaluation,
} from './test-support.ts';

// What a close does to the work of a pull request (E07-S06): the evaluations in progress end `cancelled` and their Check
// Runs are reported so, the jobs that wait are dropped through the queue, and an evaluation with a verdict is left alone.

const OTHER_HEAD = commitSha(3);

test('an evaluation in progress is set to cancelled and its Check Run is reported cancelled, for its head SHA and the row it belongs to', async () => {
  const world = await closeWorld();
  const id = await seedEvaluation(world, { result: 'in_progress' });
  expect(await world.runClose()).toEqual({ outcome: 'closed' });
  expect(await resultsOf(world)).toEqual([[PR_NUMBER, HEAD, 'cancelled']]);
  expect(world.reporter.cancellations).toEqual([
    {
      githubInstallationId: INSTALLATION,
      githubRepoId: REPOSITORY,
      fullName: FULL_NAME,
      prNumber: PR_NUMBER,
      headSha: HEAD,
      evaluationId: id,
    },
  ]);
});

test('the pending jobs are dropped through the queue port, for the pull request and for the head SHAs it has had', async () => {
  const world = await closeWorld();
  await seedEvaluation(world, { result: 'in_progress', headSha: OTHER_HEAD });
  await seedEvaluation(world, { result: 'success', headSha: commitSha(4) });
  world.pending.cancelled = 3;
  await world.runClose();
  expect(world.pending.targets).toEqual([
    {
      githubInstallationId: INSTALLATION,
      githubRepoId: REPOSITORY,
      prNumber: PR_NUMBER,
      // the evaluated head SHAs, then the one GitHub shows now (the pull request of the world has HEAD)
      headShas: [OTHER_HEAD, commitSha(4), HEAD],
    },
  ]);
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'close_pr.pruned', jobs: 3, evaluations: 1 }),
  );
});

test('a head SHA that is both evaluated and shown by GitHub is named once', async () => {
  const world = await closeWorld();
  await seedEvaluation(world, { result: 'in_progress' });
  await world.runClose();
  expect(world.pending.targets.map((target) => target.headShas)).toEqual([[HEAD]]);
});

test.each(['success', 'failure', 'cancelled'] as const)(
  'an evaluation that is %s is left untouched: no report and no write',
  async (result) => {
    const world = await closeWorld();
    await seedEvaluation(world, { result, checkRunId: 41 });
    const before = await world.rows();
    expect(await world.runClose()).toEqual({ outcome: 'closed' });
    expect(await world.rows()).toEqual(before);
    expect(world.reporter.cancellations).toEqual([]);
  },
);

test('only the evaluations in progress are cancelled: of three head SHAs, the ones with a verdict keep it', async () => {
  const world = await closeWorld();
  await seedEvaluation(world, { result: 'failure', headSha: commitSha(5) });
  await seedEvaluation(world, { result: 'in_progress', headSha: OTHER_HEAD });
  await seedEvaluation(world, { result: 'success', headSha: HEAD });
  await world.runClose();
  expect(await resultsOf(world)).toEqual([
    [PR_NUMBER, commitSha(5), 'failure'],
    [PR_NUMBER, OTHER_HEAD, 'cancelled'],
    [PR_NUMBER, HEAD, 'success'],
  ]);
  expect(world.reporter.cancellations.map((target) => target.headSha)).toEqual([OTHER_HEAD]);
});

test('two close jobs for one pull request are idempotent: the second finds nothing in progress and reports nothing again', async () => {
  const world = await closeWorld();
  await seedEvaluation(world, { result: 'in_progress' });
  expect(await world.runClose()).toEqual({ outcome: 'closed' });
  const after = await world.rows();
  expect(await world.runClose()).toEqual({ outcome: 'closed' });
  expect(await world.rows()).toEqual(after);
  expect(world.reporter.cancellations).toHaveLength(1);
  expect(world.pending.targets).toHaveLength(2);
});

test('a pull request without a row ends closed: the queue is asked about the head SHA GitHub shows, and nothing is reported', async () => {
  const world = await closeWorld();
  expect(await world.runClose()).toEqual({ outcome: 'closed' });
  expect(world.pending.targets.map((target) => target.headShas)).toEqual([[HEAD]]);
  expect(world.reporter.cancellations).toEqual([]);
  expect(await world.rows()).toEqual([]);
});

test('a pull request GitHub no longer shows is pruned from what is stored: its rows are cancelled and the queue is asked about their head SHAs', async () => {
  const world = await closeWorld();
  await seedEvaluation(world, { result: 'in_progress', prNumber: 8, headSha: OTHER_HEAD });
  expect(await world.runClose({ ...CLOSE_JOB, prNumber: 8 })).toEqual({ outcome: 'closed' });
  expect(await resultsOf(world)).toEqual([[8, OTHER_HEAD, 'cancelled']]);
  expect(world.pending.targets.map((target) => [target.prNumber, target.headShas])).toEqual([[8, [OTHER_HEAD]]]);
});

test('a pull request that GitHub does not show and that has no row names no head SHA to the queue, and still has its jobs of that number dropped', async () => {
  const world = await closeWorld();
  world.pending.cancelled = 2;
  expect(await world.runClose({ ...CLOSE_JOB, prNumber: 9 })).toEqual({ outcome: 'closed' });
  expect(world.pending.targets.map((target) => [target.prNumber, target.headShas])).toEqual([[9, []]]);
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'close_pr.pruned', jobs: 2, evaluations: 0 }),
  );
});

test('a pull request that is open again is not pruned: the job ends skipped and the evaluation the reopen started goes on', async () => {
  const world = await closeWorld();
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(PR_NUMBER));
  await seedEvaluation(world, { result: 'in_progress' });
  expect(await world.runClose()).toEqual({ outcome: 'skipped:pull_request_open' });
  expect(world.pending.targets).toEqual([]);
  expect(world.reporter.cancellations).toEqual([]);
  expect(await resultsOf(world)).toEqual([[PR_NUMBER, HEAD, 'in_progress']]);
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'close_pr.skipped', reason: 'pull_request_open' }),
  );
});

test('a head SHA that another pull request of the repository was evaluated at is not named to the queue, because the job for it may be wanted there', async () => {
  const world = await closeWorld();
  await seedEvaluation(world, { result: 'in_progress', headSha: OTHER_HEAD });
  await seedEvaluation(world, { result: 'success', prNumber: 8, headSha: OTHER_HEAD });
  await seedEvaluation(world, { result: 'success', prNumber: 8, headSha: commitSha(9) });
  await world.runClose();
  expect(world.pending.targets.map((target) => target.headShas)).toEqual([[HEAD]]);
  // its own row is still cancelled: only the jobs are left to the other pull request
  expect(await resultsOf(world)).toEqual([
    [PR_NUMBER, OTHER_HEAD, 'cancelled'],
    [8, OTHER_HEAD, 'success'],
    [8, commitSha(9), 'success'],
  ]);
});

test('the evaluation of another pull request in progress is not touched', async () => {
  const world = await closeWorld();
  await seedEvaluation(world, { result: 'in_progress', prNumber: 8, headSha: OTHER_HEAD });
  await world.runClose();
  expect(await resultsOf(world)).toEqual([[8, OTHER_HEAD, 'in_progress']]);
  expect(world.reporter.cancellations).toEqual([]);
});

test('an evaluation that got its verdict while the Check Run was being reported keeps it and is not counted', async () => {
  const world = await closeWorld();
  await seedEvaluation(world, { result: 'in_progress' });
  world.reporter.hooks.cancelled = async () => {
    await world.raw.updateTable('pr_evaluations').set({ result: 'success' }).execute();
  };
  await world.runClose();
  expect(await resultsOf(world)).toEqual([[PR_NUMBER, HEAD, 'success']]);
  expect(world.logs.lines()).toContainEqual(expect.objectContaining({ msg: 'close_pr.pruned', evaluations: 0 }));
});

test('the job reads the repository, then the pull request, and only then touches the queue, the state of the rows, the reporter and the result of the rows', async () => {
  const world = await closeWorld();
  await seedEvaluation(world, { result: 'in_progress' });
  world.timeline.length = 0;
  world.pending.behaviour = () => {
    world.timeline.push('queue.cancel');
    return Promise.resolve();
  };
  await world.runClose();
  expect(world.timeline.filter((step) => !step.startsWith('db:select'))).toEqual([
    'gh:getRepositoryById',
    'gh:getPullRequest',
    'queue.cancel',
    'db:update pr_evaluations',
    'reporter.cancelled',
    'db:update pr_evaluations',
  ]);
});
