// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { pullRef } from '../github-comment-contract/test-support.ts';
import { FAILING, listed, MOVED, NAMES, PASSING, type ReportingWorld, reportingWorld } from './test-support.ts';

// The pull requests that share a head SHA with the one that publishes (E09-S05). The Check Run belongs to the SHA, and the rows of
// the other pull requests at it decide what it says, but only the rows of pull requests that still stand at the SHA: a finished
// row of a pull request that was closed is never rewritten, and a pull request whose head moved on leaves its old row behind.

const methods = (fake: { calls: readonly { method: string }[] }): string[] => fake.calls.map((call) => call.method);

/** What GitHub lists for the commit `HEAD`: the pull requests, as `pullRef` makes them. */
/** Pull request 7 passes, started and published, with another pull request's row at the same SHA already stored. */
async function publishPassing(world: ReportingWorld) {
  const target = await world.evaluation({ result: 'success' });
  await world.reporter.started(target);
  await world.reporter.publish(target, PASSING, NAMES);
  return target;
}

test.each([
  ['a failure of a pull request that GitHub shows closed', 'failure', { state: 'closed' }],
  ['an evaluation still in progress of a pull request that GitHub shows closed', 'in_progress', { state: 'closed' }],
  ['a failure of a pull request that is open at another head SHA', 'failure', { headSha: MOVED }],
  ['an evaluation in progress of a pull request that is open at another head SHA', 'in_progress', { headSha: MOVED }],
] as const)(
  '%s does not decide the run of the pull request that is open at the SHA',
  async (_what, result, listing) => {
    const world = await reportingWorld();
    await world.evaluation({ prNumber: 8, result });
    listed(world, pullRef(8, listing), pullRef(7));
    await publishPassing(world);
    expect(world.fake.checkRuns).toHaveLength(1);
    expect(world.fake.checkRuns[0]?.run.status).toBe('completed');
    expect(world.fake.checkRuns[0]?.write).toMatchObject({ conclusion: 'success', title: 'CLA check passed' });
  },
);

test('a row of a pull request whose head moved on, a newer row of it being stored, decides nothing, and GitHub is not asked', async () => {
  const world = await reportingWorld();
  await world.evaluation({ prNumber: 8, result: 'failure', updatedAt: new Date('2026-01-01T00:00:00Z') });
  await world.evaluation({ prNumber: 8, headSha: MOVED, updatedAt: new Date('2026-01-02T00:00:00Z') });
  await publishPassing(world);
  expect(world.fake.checkRuns[0]?.write).toMatchObject({ conclusion: 'success' });
  expect(methods(world.fake)).not.toContain('listPullRequestsForCommit');
});

test.each(['failure', 'in_progress'] as const)(
  'a pull request that is open at the SHA and %s still decides the run',
  async (result) => {
    const world = await reportingWorld();
    await world.evaluation({ prNumber: 8, result });
    listed(world, pullRef(8), pullRef(7));
    await publishPassing(world);
    expect(world.fake.checkRuns[0]?.write).toMatchObject(
      result === 'failure'
        ? { status: 'completed', conclusion: 'failure', title: 'CLA check failed' }
        : { status: 'in_progress', title: 'Checking CLA signatures' },
    );
  },
);

test('a failing pull request that GitHub does not list for the commit still fails the run: a listing that misses it never turns the check green', async () => {
  const world = await reportingWorld();
  await world.evaluation({ prNumber: 8, result: 'failure' });
  listed(world, pullRef(7));
  await publishPassing(world);
  expect(world.fake.checkRuns[0]?.write).toMatchObject({ conclusion: 'failure', title: 'CLA check failed' });
});

test('the commit is listed once per publish, and only when another pull request has a row to ask about', async () => {
  const alone = await reportingWorld();
  await publishPassing(alone);
  expect(methods(alone.fake)).not.toContain('listPullRequestsForCommit');

  const cancelled = await reportingWorld();
  await cancelled.evaluation({ prNumber: 8, result: 'cancelled' });
  await publishPassing(cancelled);
  expect(methods(cancelled.fake)).not.toContain('listPullRequestsForCommit');

  const shared = await reportingWorld();
  await shared.evaluation({ prNumber: 8, result: 'success' });
  await shared.evaluation({ prNumber: 9, result: 'success' });
  await publishPassing(shared);
  expect(methods(shared.fake).filter((method) => method === 'listPullRequestsForCommit')).toHaveLength(1);
});

test('the comment of the pull request that is open says what its own evaluation found, whatever a closed one left behind', async () => {
  const world = await reportingWorld();
  await world.evaluation({ prNumber: 8, result: 'failure' });
  listed(world, pullRef(8, { state: 'closed' }), pullRef(7));
  const target = await world.evaluation({ result: 'failure' });
  await world.reporter.publish(target, FAILING, NAMES);
  expect(world.fake.checkRuns[0]?.write).toMatchObject({
    conclusion: 'failure',
    title: 'CLA signature required: 1 unsigned',
  });
});
