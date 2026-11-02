// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { pullRef } from '../github-comment-contract/test-support.ts';
import { commitSha } from '../github-pull-contract/test-support.ts';
import { jobCount } from '../jobs-fixture/test-support.ts';
import { GitHubUnavailableError } from '../ports/github-errors.ts';
import type { JobEnqueuer } from '../ports/jobs.ts';
import {
  COMMENT_JOB,
  FULL_NAME,
  HEAD,
  HEAD_JOB,
  INSTALLATION,
  PR_NUMBER,
  REPOSITORY,
  type RecheckWorld,
  recheckWorld,
} from './test-support.ts';

// The `evaluate-head-sha` job (E07-S07): a Check Run or a check suite was re-run, and the event names a head SHA and no pull
// request. GitHub says which open pull requests have it as their head, and each is evaluated again.

const evaluation = (prNumber: number) => ({
  type: 'evaluate-pr',
  githubInstallationId: INSTALLATION,
  githubRepoId: REPOSITORY,
  prNumber,
  trigger: 'check_rerequested',
});

function listed(world: RecheckWorld, pulls: Parameters<RecheckWorld['fake']['setCommitPullRequests']>[3]): void {
  world.fake.setCommitPullRequests(INSTALLATION, FULL_NAME, HEAD, pulls);
}

const rateLimited = (world: RecheckWorld) =>
  world.logs.lines().filter((line) => line['msg'] === 'recheck.rate_limited');

test('an open pull request whose head is the SHA is evaluated again: one evaluate-pr job with the trigger check_rerequested', async () => {
  const world = await recheckWorld();
  listed(world, [pullRef(PR_NUMBER)]);
  expect(await world.runHead()).toEqual({ outcome: 'enqueued' });
  expect(await world.queued()).toEqual([
    {
      idempotencyKey: `evaluate-head-sha:job-1:${PR_NUMBER}`,
      dedupeKey: `recheck:${REPOSITORY}:${PR_NUMBER}`,
      job: evaluation(PR_NUMBER),
    },
  ]);
  expect(world.calls()).toEqual(['getRepositoryById', 'listPullRequestsForCommit']);
});

test('the send is limited like the /recheck command: the dedupe key of the pull request and a window of 60 seconds', async () => {
  const world = await recheckWorld();
  listed(world, [pullRef(PR_NUMBER)]);
  await world.runHead();
  expect(world.enqueuer.calls.map((call) => call.options)).toEqual([
    {
      idempotencyKey: `evaluate-head-sha:job-1:${PR_NUMBER}`,
      dedupeKey: `recheck:${REPOSITORY}:${PR_NUMBER}`,
      dedupeWindowSeconds: 60,
    },
  ]);
});

test('only the open pull requests whose head is the SHA are evaluated: a closed one and one whose head moved on are not', async () => {
  const world = await recheckWorld();
  listed(world, [
    pullRef(5, { state: 'closed' }),
    pullRef(6, { headSha: commitSha(9) }),
    pullRef(7),
    pullRef(8, { state: 'closed', headSha: commitSha(9) }),
    pullRef(9),
  ]);
  expect(await world.runHead()).toEqual({ outcome: 'enqueued' });
  expect((await world.queued()).map((sent) => sent.job)).toEqual([evaluation(7), evaluation(9)]);
});

test('every open pull request of the SHA is evaluated, the ones from forks too: the listing is not narrowed to a repository', async () => {
  const world = await recheckWorld();
  listed(world, [pullRef(7), pullRef(11), pullRef(12)]);
  await world.runHead();
  expect((await world.queued()).map((sent) => sent.job)).toEqual([evaluation(7), evaluation(11), evaluation(12)]);
});

test('at most 20 pull requests are evaluated, the first 20 of the listing', async () => {
  const world = await recheckWorld();
  listed(
    world,
    Array.from({ length: 25 }, (_, index) => pullRef(100 + index)),
  );
  await world.runHead();
  const sent = await world.queued();
  expect(sent).toHaveLength(20);
  expect(sent.map((one) => (one.job.type === 'evaluate-pr' ? one.job.prNumber : 0))).toEqual(
    Array.from({ length: 20 }, (_, index) => 100 + index),
  );
});

test.each([
  ['GitHub knows no pull request for the SHA', []],
  ['the only pull request is closed', [pullRef(7, { state: 'closed' })]],
  ['the only pull request has another head', [pullRef(7, { headSha: commitSha(9) })]],
])('no matching pull request ends the job (%s)', async (_why, pulls) => {
  const world = await recheckWorld();
  listed(world, pulls);
  expect(await world.runHead()).toEqual({ outcome: 'skipped:no_pull_request' });
  expect(world.enqueuer.calls).toEqual([]);
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'rerun.skipped', reason: 'no_pull_request' }),
  );
});

test('a SHA nobody listed ends the job as well: there is nothing to evaluate', async () => {
  const world = await recheckWorld();
  expect(await world.runHead()).toEqual({ outcome: 'skipped:no_pull_request' });
});

test('a Re-run within a minute of a /recheck on the same pull request is dropped, and logged recheck.rate_limited', async () => {
  const world = await recheckWorld();
  listed(world, [pullRef(PR_NUMBER)]);
  await world.runComment(COMMENT_JOB);
  world.clock.advance(10_000);
  expect(await world.runHead()).toEqual({ outcome: 'rate_limited' });
  expect(await jobCount(world.raw)).toBe(1);
  expect(rateLimited(world)).toEqual([expect.objectContaining({ prNumber: PR_NUMBER })]);
  world.clock.advance(51_000);
  expect(await world.runHead()).toEqual({ outcome: 'enqueued' });
  expect(await jobCount(world.raw)).toBe(2);
});

test('only the pull request that took a re-evaluation a moment ago is dropped: the others of the SHA are evaluated', async () => {
  const world = await recheckWorld();
  listed(world, [pullRef(PR_NUMBER), pullRef(8)]);
  await world.runComment(COMMENT_JOB);
  expect(await world.runHead()).toEqual({ outcome: 'enqueued' });
  expect((await world.queued()).map((sent) => sent.dedupeKey)).toEqual([
    `recheck:${REPOSITORY}:${PR_NUMBER}`,
    `recheck:${REPOSITORY}:8`,
  ]);
  expect(rateLimited(world)).toEqual([expect.objectContaining({ prNumber: PR_NUMBER })]);
});

test('a retry of the job sends nothing twice: the evaluations are named after the job and the pull request', async () => {
  const world = await recheckWorld();
  listed(world, [pullRef(PR_NUMBER), pullRef(8)]);
  await world.runHead();
  expect(await world.runHead()).toEqual({ outcome: 'enqueued' });
  expect(await jobCount(world.raw)).toBe(2);
});

test('the evaluations are sent in one transaction: when the queue refuses the second, the first is not sent either', async () => {
  const world = await recheckWorld();
  listed(world, [pullRef(PR_NUMBER), pullRef(8)]);
  const refused = new Error('the queue refused the job');
  const queue: JobEnqueuer = {
    enqueue: (tx, job, options) =>
      job.type === 'evaluate-pr' && job.prNumber === 8
        ? Promise.reject(refused)
        : world.enqueuer.enqueue(tx, job, options),
  };
  await expect(world.runHead(undefined, queue)).rejects.toBe(refused);
  expect(await jobCount(world.raw)).toBe(0);
  expect(await world.runHead()).toEqual({ outcome: 'enqueued' });
  expect(await jobCount(world.raw)).toBe(2);
});

test('an outage of GitHub fails the job with nothing sent, and the retry sends the evaluations', async () => {
  const world = await recheckWorld();
  listed(world, [pullRef(PR_NUMBER)]);
  const outage = new GitHubUnavailableError('GitHub answered 500');
  world.fake.failNext('listPullRequestsForCommit', outage);
  await expect(world.runHead()).rejects.toBe(outage);
  expect(await jobCount(world.raw)).toBe(0);
  expect(await world.runHead()).toEqual({ outcome: 'enqueued' });
});

const NOT_EVALUATED = [
  ['installation_rejected', "update installations set admission_status = 'rejected'"],
  ['installation_deleted', 'update installations set deleted_at = now()'],
  ['installation_suspended', 'update installations set suspended_at = now()'],
  ['repository_removed', 'update repositories set removed_at = now()'],
  ['repository_disabled', 'update repositories set enabled = false'],
] as const;

test.each(NOT_EVALUATED)(
  'a tenant that is %s ends the job as skipped, logs the reason and makes no GitHub call and sends nothing',
  async (reason, statement) => {
    const world = await recheckWorld();
    listed(world, [pullRef(PR_NUMBER)]);
    await sql.raw(statement).execute(world.raw);
    expect(await world.runHead()).toEqual({ outcome: `skipped:${reason}` });
    expect(world.calls()).toEqual([]);
    expect(world.enqueuer.calls).toEqual([]);
    expect(world.logs.lines()).toContainEqual(expect.objectContaining({ msg: 'rerun.skipped', reason }));
  },
);

test('an installation or a repository nobody stored ends the job as skipped with no GitHub call', async () => {
  const world = await recheckWorld();
  expect(await world.runHead({ ...HEAD_JOB, githubInstallationId: parseGithubId(999_999) })).toEqual({
    outcome: 'skipped:installation_not_found',
  });
  expect(await world.runHead({ ...HEAD_JOB, githubRepoId: parseGithubId(123_456) })).toEqual({
    outcome: 'skipped:repository_not_found',
  });
  expect(world.calls()).toEqual([]);
});

test('a repository GitHub no longer shows the installation ends the job before the listing is asked for', async () => {
  const world = await recheckWorld();
  world.fake.setRepositories(INSTALLATION, []);
  expect(await world.runHead()).toEqual({ outcome: 'skipped:repository_gone' });
  expect(world.calls()).not.toContain('listPullRequestsForCommit');
  expect(world.enqueuer.calls).toEqual([]);
});

test.each([
  [
    'GitHub no longer has it',
    (world: RecheckWorld) => {
      world.fake.removeInstallation(INSTALLATION);
    },
  ],
  [
    'the gate refuses it',
    (world: RecheckWorld) => {
      world.gate.refuse(INSTALLATION, 'rejected');
    },
  ],
])('an installation that cannot be served (%s) ends the job as skipped, without a retry', async (_why, apply) => {
  const world = await recheckWorld();
  apply(world);
  expect(await world.runHead()).toEqual({ outcome: 'skipped:installation_unavailable' });
});
