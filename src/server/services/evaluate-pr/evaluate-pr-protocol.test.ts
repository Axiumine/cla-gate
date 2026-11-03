// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { account, commitSha, pullRequest } from '../github-pull-contract/test-support.ts';
import {
  defaultCommits,
  type EvaluateWorld,
  evaluateWorld,
  FULL_NAME,
  INSTALLATION,
  JOB,
  PR_NUMBER,
} from './test-support.ts';

// What step 8 decides, and when a job may be answered by what is stored (E07-S04).

const MOVED = commitSha(3);
const PUSHED = pullRequest(PR_NUMBER, { headSha: MOVED });
const CLOSED = pullRequest(PR_NUMBER, { state: 'closed' });

/** Changes the pull request on GitHub while the reporter is told the evaluation began: a push, or a close, in mid-run. */
function changeDuringRun(world: EvaluateWorld, change: ReturnType<typeof pullRequest>): void {
  world.reporter.hooks.started = () => {
    world.fake.addPullRequest(INSTALLATION, FULL_NAME, change);
    return Promise.resolve();
  };
}

test('a push during the run discards the result: the row stays in progress with empty details, nothing is reported, and the job completes as superseded', async () => {
  const world = await evaluateWorld();
  changeDuringRun(world, PUSHED);
  expect(await world.run()).toEqual({ outcome: 'superseded' });
  expect(world.evaluate).toHaveBeenCalledOnce();
  expect(world.reporter.published).toEqual([]);
  expect((await world.rows()).map((row) => [row.head_sha, row.result, row.details])).toEqual([
    [commitSha(2), 'in_progress', {}],
  ]);
});

test('a close during the run discards the result as well', async () => {
  const world = await evaluateWorld();
  changeDuringRun(world, CLOSED);
  expect(await world.run()).toEqual({ outcome: 'superseded' });
  expect(world.reporter.published).toEqual([]);
  expect((await world.rows()).map((row) => row.result)).toEqual(['in_progress']);
});

test('the evaluation of the new head SHA has a row of its own, and the discarded one is left as it was', async () => {
  const world = await evaluateWorld();
  changeDuringRun(world, PUSHED);
  await world.run();
  world.reporter.hooks.started = undefined;
  expect(await world.run()).toEqual({ outcome: 'evaluated' });
  expect((await world.rows()).map((row) => [row.head_sha, row.result])).toEqual([
    [commitSha(2), 'in_progress'],
    [MOVED, 'success'],
  ]);
  expect(world.reporter.published.map((report) => report.target.headSha)).toEqual([MOVED]);
});

/** The world after one evaluation whose row has a Check Run, as the reporter of E09 leaves it when it starts. */
async function evaluatedOnce(): Promise<EvaluateWorld> {
  const world = await evaluateWorld();
  world.reporter.hooks.started = async (target) => {
    await world.raw
      .updateTable('pr_evaluations')
      .set({ check_run_id: 777 })
      .where('id', '=', target.evaluationId)
      .execute();
  };
  expect(await world.run()).toEqual({ outcome: 'evaluated' });
  world.fake.calls.length = 0;
  return world;
}

test('a pull_request delivery for a head SHA with a final result and a Check Run changes nothing: no report, no engine, no commit read', async () => {
  const world = await evaluatedOnce();
  expect(await world.run()).toEqual({ outcome: 'unchanged' });
  expect(world.calls()).toEqual(['getRepositoryById', 'getPullRequest']);
  expect(world.evaluate).toHaveBeenCalledOnce();
  expect(world.reporter.startedTargets).toHaveLength(1);
  expect(world.reporter.published).toHaveLength(1);
});

test('ten queued edited deliveries collapse into one evaluation', async () => {
  const world = await evaluatedOnce();
  const outcomes: string[] = [];
  for (let delivery = 0; delivery < 9; delivery += 1) {
    outcomes.push((await world.run()).outcome);
  }
  expect(outcomes).toEqual(Array.from({ length: 9 }, () => 'unchanged'));
  expect(world.evaluate).toHaveBeenCalledOnce();
  expect(world.reporter.published).toHaveLength(1);
  expect(await world.rows()).toHaveLength(1);
});

test.each(['recheck', 'check_rerequested', 'signature', 'sweep', 'policy_change'] as const)(
  'the trigger %s evaluates again, over the same row and the same Check Run',
  async (trigger) => {
    const world = await evaluatedOnce();
    const [before] = await world.rows();
    expect(await world.run({ ...JOB, trigger })).toEqual({ outcome: 'evaluated' });
    expect(world.evaluate).toHaveBeenCalledTimes(2);
    expect(world.reporter.published.at(-1)?.target.trigger).toBe(trigger);
    const rows = await world.rows();
    expect(rows).toHaveLength(1);
    expect([rows[0]?.id, rows[0]?.check_run_id]).toEqual([before?.id, 777]);
  },
);

test('a row that is in progress is evaluated again by a pull_request delivery, even with a Check Run', async () => {
  const world = await evaluatedOnce();
  await world.raw.updateTable('pr_evaluations').set({ result: 'in_progress', details: '{}' }).execute();
  expect(await world.run()).toEqual({ outcome: 'evaluated' });
  expect(world.evaluate).toHaveBeenCalledTimes(2);
});

test('a failure with a Check Run is final as well', async () => {
  const world = await evaluatedOnce();
  await world.raw
    .updateTable('pr_evaluations')
    .set({ result: 'failure', details: JSON.stringify({ outcome: 'failure' }) })
    .execute();
  expect(await world.run()).toEqual({ outcome: 'unchanged' });
});

test('a final row without a Check Run is evaluated again: nothing shows that its verdict was ever reported', async () => {
  const world = await evaluateWorld();
  await world.run();
  expect(await world.run()).toEqual({ outcome: 'evaluated' });
  expect(world.evaluate).toHaveBeenCalledTimes(2);
});

test('a retry never takes the shortcut: the run before it may have stored the verdict and died before the report went out', async () => {
  const world = await evaluatedOnce();
  expect(await world.run(JOB, { attempt: 1 })).toEqual({ outcome: 'evaluated' });
  expect(world.reporter.published).toHaveLength(2);
});

test('the same head SHA of another pull request is another evaluation', async () => {
  const world = await evaluatedOnce();
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(8, { opener: account(7) }));
  world.fake.setPullRequestCommits(INSTALLATION, FULL_NAME, 8, defaultCommits());
  expect(await world.run({ ...JOB, prNumber: 8 })).toEqual({ outcome: 'evaluated' });
  expect((await world.rows()).map((row) => row.pr_number)).toEqual([PR_NUMBER, 8]);
});
