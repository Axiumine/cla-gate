// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { comment } from '../github-comment-contract/test-support.ts';
import { pullRequest } from '../github-pull-contract/test-support.ts';
import { jobCount } from '../jobs-fixture/test-support.ts';
import {
  COMMENT_ID,
  COMMENT_JOB,
  FULL_NAME,
  INSTALLATION,
  PR_NUMBER,
  REPOSITORY,
  recheckWorld,
} from './test-support.ts';

// The `recheck-comment` job when the comment is the command (E07-S07): one `evaluate-pr` job with the trigger `recheck`,
// at most one a minute per pull request.

const EVALUATION = {
  type: 'evaluate-pr',
  githubInstallationId: INSTALLATION,
  githubRepoId: REPOSITORY,
  prNumber: PR_NUMBER,
  trigger: 'recheck',
};

test('a comment that is the command sends one evaluate-pr job with the trigger recheck, the ids of the pull request and nothing else', async () => {
  const world = await recheckWorld();
  expect(await world.runComment({ ...COMMENT_JOB, deliveryId: '5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c' })).toEqual({
    outcome: 'enqueued',
  });
  expect(await world.queued()).toEqual([
    { idempotencyKey: 'recheck-comment:5001', dedupeKey: `recheck:${REPOSITORY}:${PR_NUMBER}`, job: EVALUATION },
  ]);
});

test('the send is rate limited per pull request: one a minute under the dedupe key recheck:<repo id>:<pr number>', async () => {
  const world = await recheckWorld();
  await world.runComment();
  expect(world.enqueuer.calls).toEqual([
    {
      job: EVALUATION,
      options: {
        idempotencyKey: 'recheck-comment:5001',
        dedupeKey: `recheck:${REPOSITORY}:${PR_NUMBER}`,
        dedupeWindowSeconds: 60,
      },
    },
  ]);
});

test('GitHub is asked for the repository, then the comment, then the pull request, and for nothing else', async () => {
  const world = await recheckWorld();
  await world.runComment();
  expect(world.calls()).toEqual(['getRepositoryById', 'getIssueComment', 'getPullRequest']);
  expect(world.fake.calls.every((call) => call.installationId === INSTALLATION)).toBe(true);
});

test('the decision is on the comment GitHub returns now, not on the text the webhook saw: an edit that removed the command ends the job', async () => {
  const world = await recheckWorld();
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, comment(COMMENT_ID, { body: 'never mind' }));
  expect(await world.runComment()).toEqual({ outcome: 'skipped:not_a_command' });
  expect(await jobCount(world.raw)).toBe(0);
});

test('the command is found in a comment written on Windows, among other lines', async () => {
  const world = await recheckWorld();
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, comment(COMMENT_ID, { body: 'I signed.\r\n/recheck\r\nThanks' }));
  expect(await world.runComment()).toEqual({ outcome: 'enqueued' });
  expect((await world.queued()).map((sent) => sent.job.type)).toEqual(['evaluate-pr']);
});

test('a comment by an organisation, a mannequin or an account of a kind nobody knows is a comment by a person: only a bot is refused', async () => {
  const world = await recheckWorld();
  for (const [index, type] of (['Organization', 'Mannequin', 'Other'] as const).entries()) {
    const id = parseGithubId(6000 + index);
    world.fake.addIssueComment(INSTALLATION, FULL_NAME, comment(id, { author: { id: parseGithubId(9), type } }));
    world.clock.advance(61_000);
    expect(await world.runComment({ ...COMMENT_JOB, commentId: id })).toEqual({ outcome: 'enqueued' });
  }
  expect(await jobCount(world.raw)).toBe(3);
});

test('two commands ten seconds apart give one evaluation, and the second is dropped without a reply and logged recheck.rate_limited', async () => {
  const world = await recheckWorld();
  const second = parseGithubId(5002);
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, comment(second));
  expect(await world.runComment()).toEqual({ outcome: 'enqueued' });
  world.clock.advance(10_000);
  expect(await world.runComment({ ...COMMENT_JOB, commentId: second })).toEqual({ outcome: 'rate_limited' });
  expect(await jobCount(world.raw)).toBe(1);
  expect(world.logs.lines().filter((line) => line['msg'] === 'recheck.rate_limited')).toEqual([
    expect.objectContaining({ prNumber: PR_NUMBER, level: 30 }),
  ]);
  expect(world.reporter.published).toEqual([]);
  expect(world.reporter.startedTargets).toEqual([]);
});

test('two commands sixty-one seconds apart give two evaluations', async () => {
  const world = await recheckWorld();
  const second = parseGithubId(5002);
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, comment(second));
  await world.runComment();
  world.clock.advance(61_000);
  expect(await world.runComment({ ...COMMENT_JOB, commentId: second })).toEqual({ outcome: 'enqueued' });
  expect(await jobCount(world.raw)).toBe(2);
  expect(world.logs.lines().filter((line) => line['msg'] === 'recheck.rate_limited')).toEqual([]);
});

test('the limit belongs to the pull request: a command on another pull request is not dropped by it', async () => {
  const world = await recheckWorld();
  const other = parseGithubId(5003);
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, comment(other, { issueNumber: 8 }));
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(8));
  await world.runComment();
  expect(await world.runComment({ ...COMMENT_JOB, commentId: other, prNumber: 8 })).toEqual({ outcome: 'enqueued' });
  expect((await world.queued()).map((sent) => sent.dedupeKey)).toEqual([
    `recheck:${REPOSITORY}:7`,
    `recheck:${REPOSITORY}:8`,
  ]);
});

test('a retry of the job that already sent the evaluation does not queue another: the job is still enqueued, once', async () => {
  const world = await recheckWorld();
  expect(await world.runComment()).toEqual({ outcome: 'enqueued' });
  expect(await world.runComment()).toEqual({ outcome: 'enqueued' });
  expect(await jobCount(world.raw)).toBe(1);
  expect(world.logs.lines().filter((line) => line['msg'] === 'recheck.rate_limited')).toEqual([]);
});

test('any commenter can ask: the author association of the comment is not read, and a draft pull request is evaluated like any other', async () => {
  const world = await recheckWorld();
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(PR_NUMBER, { draft: true }));
  expect(await world.runComment()).toEqual({ outcome: 'enqueued' });
});
