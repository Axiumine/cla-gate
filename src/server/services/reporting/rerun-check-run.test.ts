// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import { pullRef } from '../github-comment-contract/test-support.ts';
import { account, commit, commitSha, pullRequest } from '../github-pull-contract/test-support.ts';
import { deliveryRows } from '../jobs-fixture/test-support.ts';
import type { FakeGitHub } from '../test-support.ts';
import {
  evaluateFirst,
  FULL_NAME,
  HEAD,
  INSTALLATION,
  ORG_1,
  PR_NUMBER,
  rerunWorld,
  runIds,
  tenantPayload,
  writesOf,
} from './rerun-fixture/test-support.ts';
import { FAILING } from './test-support.ts';

// Re-run and Re-run all checks end in a fresh run (E09-S08), through the real route, jobs and reporter: a signed `check_run` or
// `check_suite` delivery of the head SHA of pull request 7, whose first evaluation failed, is routed to one `evaluate-head-sha`
// job, which sends one `evaluate-pr` with the trigger `check_rerequested`, which posts one new run in progress and completes it.

test.each([['check_run'], ['check_suite']] as const)(
  'a %s rerequested for the current head makes one evaluate-head-sha, one evaluate-pr with the trigger check_rerequested, and one new run POSTed in progress and PATCHed completed',
  async (event) => {
    const world = await rerunWorld();
    await evaluateFirst(world);
    const [earlier] = runIds(world.fake);
    const answer = await world.deliver(event);
    expect([answer.statusCode, answer.json()]).toEqual([202, { status: 'accepted' }]);
    expect(await world.drain()).toEqual(['evaluate-head-sha:enqueued', 'evaluate-pr:evaluated']);
    const [, fresh, ...more] = runIds(world.fake);
    expect([typeof fresh, more]).toEqual(['number', []]);
    expect((await world.queued()).slice(1).map((sent) => sent.job)).toMatchObject([
      { type: 'evaluate-head-sha', githubInstallationId: INSTALLATION, headSha: HEAD },
      { type: 'evaluate-pr', prNumber: PR_NUMBER, trigger: 'check_rerequested' },
    ]);
    expect(writesOf(world.fake)).toEqual([
      `POST ${earlier} in_progress`,
      `PATCH ${earlier} completed failure`,
      `POST ${fresh} in_progress`,
      `PATCH ${fresh} completed success`,
    ]);
    expect((await world.rows()).map((row) => [row.result, row.check_run_id])).toEqual([['success', fresh]]);
    expect((await deliveryRows(world.raw)).map((row) => row.processed_at !== null)).toEqual([true, true]);
  },
);

/** What a stored run was last written: its state, its conclusion and its title. */
const lastWrite = (stored: FakeGitHub['checkRuns'][number] | undefined) => [
  stored?.run.status,
  stored?.write?.conclusion,
  stored?.write?.title,
];

test('the run that was re-run stays what it was: it keeps its verdict, the run beside it holds the new one, both on the same SHA', async () => {
  const world = await rerunWorld();
  await evaluateFirst(world);
  await world.deliver('check_run');
  await world.drain();
  const [earlier, fresh] = world.fake.checkRuns;
  expect(lastWrite(earlier)).toEqual(['completed', 'failure', 'CLA signature required: 1 unsigned']);
  expect(lastWrite(fresh)).toEqual(['completed', 'success', 'CLA check passed']);
  expect(world.fake.checkRuns.map((stored) => [stored.run.headSha, stored.fullName])).toEqual([
    [HEAD, FULL_NAME],
    [HEAD, FULL_NAME],
  ]);
});

test('a re-run that finds the pull request still failing posts a new failing run and edits the one comment, never a second one', async () => {
  const world = await rerunWorld();
  await evaluateFirst(world);
  world.evaluate.mockReturnValueOnce(FAILING);
  await world.deliver('check_run');
  expect(await world.drain()).toEqual(['evaluate-head-sha:enqueued', 'evaluate-pr:evaluated']);
  const methods = world.fake.calls.map((call) => call.method);
  expect(methods.filter((method) => method === 'createIssueComment')).toHaveLength(1);
  expect(methods.filter((method) => method === 'updateIssueComment')).toHaveLength(1);
  expect(writesOf(world.fake).slice(2)).toEqual([
    `POST ${runIds(world.fake)[1]} in_progress`,
    `PATCH ${runIds(world.fake)[1]} completed failure`,
  ]);
});

const FORK_HEAD = commitSha(3);

/** The payload of a re-run of the run on `FORK_HEAD`: GitHub sends no pull request with it, because the pull request comes from a fork. */
function forkPayload(): Record<string, unknown> {
  return tenantPayload('check_run', ORG_1, FORK_HEAD);
}

test('a fork pull request: the payload names no pull request, the job lists them by SHA, and the run is created on the base repository for the fork head', async () => {
  const world = await rerunWorld();
  const named = z.object({ check_run: z.object({ pull_requests: z.array(z.unknown()) }) }).parse(forkPayload());
  expect(named.check_run.pull_requests).toEqual([]);
  world.fake.addPullRequest(
    INSTALLATION,
    FULL_NAME,
    pullRequest(8, { headSha: FORK_HEAD, commitCount: 3, opener: account(7) }),
  );
  world.fake.setPullRequestCommits(INSTALLATION, FULL_NAME, 8, [commit(1), commit(2), commit(3)]);
  world.fake.setCommitPullRequests(INSTALLATION, FULL_NAME, FORK_HEAD, [pullRef(8, { headSha: FORK_HEAD })]);
  expect((await world.deliver('check_run', forkPayload())).statusCode).toBe(202);
  expect(await world.drain()).toEqual(['evaluate-head-sha:enqueued', 'evaluate-pr:evaluated']);
  expect(world.fake.calls.map((call) => call.method)).toContain('listPullRequestsForCommit');
  expect((await world.queued()).map((sent) => sent.job)).toMatchObject([
    { type: 'evaluate-head-sha', headSha: FORK_HEAD },
    { type: 'evaluate-pr', prNumber: 8, trigger: 'check_rerequested' },
  ]);
  const [run] = runIds(world.fake);
  expect(writesOf(world.fake)).toEqual([`POST ${run} in_progress`, `PATCH ${run} completed success`]);
  expect(world.fake.checkRuns.map((stored) => [stored.fullName, stored.run.headSha])).toEqual([[FULL_NAME, FORK_HEAD]]);
});
