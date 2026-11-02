// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import type { PendingWorkTarget } from '../../services/ports/jobs.ts';
import { PgBossPendingJobs } from './pending.ts';
import { fakeBoss } from './test-support.ts';

// Which jobs the closing of a pull request cancels, and how (E07-S06), with a pg-boss that is only a script. Against a real
// queue: pending-real.test.ts.

const HEAD = 'a'.repeat(40);
const OTHER_HEAD = 'b'.repeat(40);
const REPOSITORY = { githubInstallationId: parseGithubId(5000), githubRepoId: parseGithubId(9000) };
const TARGET: PendingWorkTarget = { ...REPOSITORY, prNumber: 7, headShas: [HEAD] };

test('the jobs of the pull request are looked for by the installation, the repository and the number, in the queues that carry the number', async () => {
  const boss = fakeBoss();
  await new PgBossPendingJobs(boss).cancelForPullRequest({ ...TARGET, headShas: [] });
  expect(boss.findJobs.mock.calls).toEqual([
    ['evaluate-pr', { data: { ...REPOSITORY, prNumber: 7 }, queued: true }],
    ['recheck-comment', { data: { ...REPOSITORY, prNumber: 7 }, queued: true }],
  ]);
});

test('the evaluate-head-sha jobs are looked for by the head SHA, once for each head SHA the pull request has had', async () => {
  const boss = fakeBoss();
  await new PgBossPendingJobs(boss).cancelForPullRequest({ ...TARGET, headShas: [HEAD, OTHER_HEAD] });
  expect(boss.findJobs.mock.calls.filter(([queue]) => queue === 'evaluate-head-sha')).toEqual([
    ['evaluate-head-sha', { data: { ...REPOSITORY, headSha: HEAD }, queued: true }],
    ['evaluate-head-sha', { data: { ...REPOSITORY, headSha: OTHER_HEAD }, queued: true }],
  ]);
});

test('only the jobs that wait are asked for, never the ones that run', async () => {
  const boss = fakeBoss();
  await new PgBossPendingJobs(boss).cancelForPullRequest(TARGET);
  expect(boss.findJobs.mock.calls.map(([, options]) => options.queued)).toEqual([true, true, true]);
});

test('the jobs found are cancelled by id, in the queue they were found in, and counted', async () => {
  const boss = fakeBoss();
  const waiting = new Map([
    [
      'evaluate-pr',
      [
        { id: 'job-a', state: 'created' },
        { id: 'job-b', state: 'retry' },
      ],
    ],
    ['evaluate-head-sha', [{ id: 'job-c', state: 'created' }]],
  ]);
  boss.findJobs.mockImplementation((queue) => Promise.resolve(waiting.get(queue) ?? []));
  expect(await new PgBossPendingJobs(boss).cancelForPullRequest(TARGET)).toBe(3);
  expect(boss.cancel.mock.calls).toEqual([
    ['evaluate-pr', ['job-a', 'job-b']],
    ['evaluate-head-sha', ['job-c']],
  ]);
});

test('nothing is cancelled when nothing waits: no call is made for an empty list, and the answer is zero', async () => {
  const boss = fakeBoss();
  expect(await new PgBossPendingJobs(boss).cancelForPullRequest(TARGET)).toBe(0);
  expect(boss.cancel).not.toHaveBeenCalled();
});

test('a failure of the queue is not swallowed: the close fails and is retried', async () => {
  const boss = fakeBoss();
  const down = new Error('the queue is down');
  boss.findJobs.mockRejectedValueOnce(down);
  await expect(new PgBossPendingJobs(boss).cancelForPullRequest(TARGET)).rejects.toBe(down);
});

test('a failure to cancel is not swallowed either', async () => {
  const boss = fakeBoss();
  boss.findJobs.mockResolvedValueOnce([{ id: 'job-a', state: 'created' }]);
  const down = new Error('the queue is down');
  boss.cancel.mockRejectedValueOnce(down);
  await expect(new PgBossPendingJobs(boss).cancelForPullRequest(TARGET)).rejects.toBe(down);
});
