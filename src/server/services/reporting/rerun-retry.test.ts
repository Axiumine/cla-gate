// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { GitHubUnavailableError } from '../ports/github-errors.ts';
import {
  COMMENT_ID,
  evaluateFirst,
  INSTALLATION,
  PR_NUMBER,
  REPOSITORY,
  rerunWorld,
  runIds,
  writesOf,
} from './rerun-fixture/test-support.ts';

// A re-run that is interrupted, and the other way to ask for one (E09-S08): a job that crashes after it began the check and is
// retried reuses the run in progress, and `/recheck` takes the same path as Re-run and ends in a fresh run.

const created = (calls: readonly { method: string }[]): number =>
  calls.filter((call) => call.method === 'createCheckRun').length;

test.each([
  ['after the id of the new run was recorded on the row', false],
  ['between the POST of the new run and the write of its id, which leaves the id of the earlier run on the row', true],
] as const)(
  'a re-run job that crashes %s and is retried reuses the run in progress: there is one new run and it is completed',
  async (_crash, idLost) => {
    const world = await rerunWorld();
    await evaluateFirst(world);
    const [earlier] = runIds(world.fake);
    await world.deliver('check_run');
    world.fake.failNext('listPullRequestCommits', new GitHubUnavailableError('GitHub is down'));
    expect(await world.drain()).toEqual(['evaluate-head-sha:enqueued', 'evaluate-pr:failed']);
    const [, fresh] = runIds(world.fake);
    expect(writesOf(world.fake).slice(2)).toEqual([`POST ${fresh} in_progress`]);
    if (idLost) {
      await sql`update pr_evaluations set check_run_id = ${earlier}`.execute(world.raw);
    }
    expect(await world.drain(true)).toEqual(['evaluate-pr:evaluated']);
    expect(runIds(world.fake)).toEqual([earlier, fresh]);
    expect(created(world.fake.calls)).toBe(2);
    expect(writesOf(world.fake).slice(2)).toEqual([`POST ${fresh} in_progress`, `PATCH ${fresh} completed success`]);
    expect((await world.rows()).map((row) => [row.result, row.check_run_id])).toEqual([['success', fresh]]);
  },
);

test('/recheck takes the same path with the trigger recheck and also gets a fresh run, so the person sees the check start again', async () => {
  const world = await rerunWorld();
  await evaluateFirst(world);
  const [earlier] = runIds(world.fake);
  const answer = await world.deliver('issue_comment');
  expect([answer.statusCode, answer.json()]).toEqual([202, { status: 'accepted' }]);
  expect(await world.drain()).toEqual(['recheck-comment:enqueued', 'evaluate-pr:evaluated']);
  expect((await world.queued()).slice(1).map((sent) => sent.job)).toMatchObject([
    { type: 'recheck-comment', githubInstallationId: INSTALLATION, githubRepoId: REPOSITORY, commentId: COMMENT_ID },
    { type: 'evaluate-pr', prNumber: PR_NUMBER, trigger: 'recheck' },
  ]);
  const [, fresh, ...more] = runIds(world.fake);
  expect(more).toEqual([]);
  expect(writesOf(world.fake)).toEqual([
    `POST ${earlier} in_progress`,
    `PATCH ${earlier} completed failure`,
    `POST ${fresh} in_progress`,
    `PATCH ${fresh} completed success`,
  ]);
  expect((await world.rows()).map((row) => [row.result, row.check_run_id])).toEqual([['success', fresh]]);
});
