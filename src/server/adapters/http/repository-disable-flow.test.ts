// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { sentJobs } from '../../services/jobs-fixture/test-support.ts';
import { disableAs, disabledAnswerOf } from './repository-disable-fixture/test-support.ts';
import { enableAs, enabledAnswerOf } from './repository-enable-fixture/test-support.ts';
import { COVERED, flowWorld, UNCOVERED } from './repository-flow-fixture/test-support.ts';

// Turning a repository off, from the click to the Check Runs (E14-S04), with GitHub stubbed by MSW behind the real Octokit adapter
// and the jobs run in-process, in the order the queue would: the real engine, the real reporter. A repository with a covered and an
// uncovered pull request is enabled and evaluated, then disabled, and the check that was red ends neutral.

/** A world whose repository is on and evaluated: COVERED is `success`, UNCOVERED is `failure`. */
async function evaluatedWorld() {
  const world = await flowWorld();
  await enableAs(world, 'admin1', world.t1.plain.repositoryId);
  await world.drain();
  return world;
}

/** The stored result of the two pull requests of the flow, by pull request number. */
const resultsOf = (world: Awaited<ReturnType<typeof evaluatedWorld>>) =>
  world.db
    .selectFrom('pr_evaluations')
    .select(['pr_number', 'result'])
    .where('pr_number', 'in', [COVERED, UNCOVERED])
    .orderBy('pr_number')
    .execute();

test('disabling completes the red check neutral and the comment becomes the notice, leaves the green one alone, and writes no verdict', async () => {
  const world = await evaluatedWorld();
  expect([await world.conclusionOf(COVERED), await world.conclusionOf(UNCOVERED)]).toEqual(['success', 'failure']);
  const results = await resultsOf(world);
  const written = world.github.requests.length;
  const response = await disableAs(world, 'admin1', world.t1.plain.repositoryId);
  expect([response.statusCode, disabledAnswerOf(response)]).toEqual([200, { enabled: false, changed: true }]);
  await world.drain();
  expect([await world.conclusionOf(COVERED), await world.conclusionOf(UNCOVERED)]).toEqual(['success', 'neutral']);
  const checks = (await sentJobs(world.db)).flatMap((sent) =>
    sent.job.type === 'finalise-check' ? [sent.job.prNumber] : [],
  );
  // Pull request 8 is a row the world was seeded with, whose pull request GitHub does not have: its job ends skipped.
  expect(checks.toSorted((a, b) => a - b)).toEqual([8, UNCOVERED]);
  const requests = world.github.requests.slice(written).filter((request) => !request.startsWith('GET'));
  expect(requests.map((request) => request.replace(/\/\d+$/, '/:id'))).toEqual([
    'PATCH /repos/org-1/repo/check-runs/:id',
    'PATCH /repos/org-1/repo/issues/comments/:id',
  ]);
  expect(await resultsOf(world)).toEqual(results);
  expect(results).toEqual([
    { pr_number: COVERED, result: 'success' },
    { pr_number: UNCOVERED, result: 'failure' },
  ]);
});

test('disabling a repository that is off does nothing, and turning it on again sweeps the open pull requests and restores the real results', async () => {
  const world = await evaluatedWorld();
  await disableAs(world, 'admin1', world.t1.plain.repositoryId);
  await world.drain();
  const jobs = (await sentJobs(world.db)).length;
  const requests = world.github.requests.length;
  const again = await disableAs(world, 'admin1', world.t1.plain.repositoryId);
  expect(disabledAnswerOf(again)).toEqual({ enabled: false, changed: false });
  await world.drain();
  expect([(await sentJobs(world.db)).length, world.github.requests.length]).toEqual([jobs, requests]);
  expect(await world.conclusionOf(UNCOVERED)).toBe('neutral');
  const response = await enableAs(world, 'admin1', world.t1.plain.repositoryId);
  expect([response.statusCode, enabledAnswerOf(response)]).toEqual([200, { enabled: true, changed: true }]);
  await world.drain();
  expect([await world.conclusionOf(COVERED), await world.conclusionOf(UNCOVERED)]).toEqual(['success', 'failure']);
  // The flow runs the jobs of enforcement and refuses any other type, so a job it does not model cannot pass unnoticed.
  await world.db.transaction().execute((tx) =>
    world.queue.enqueue(
      tx,
      {
        type: 'close-pr',
        githubInstallationId: world.t1.githubInstallationId,
        githubRepoId: world.t1.plain.githubRepoId,
        prNumber: COVERED,
      },
      { idempotencyKey: 'close-1' },
    ),
  );
  await expect(world.drain()).rejects.toThrow('the flow does not run close-pr');
});
