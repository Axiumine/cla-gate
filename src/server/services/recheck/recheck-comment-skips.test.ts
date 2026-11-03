// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
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
  type RecheckWorld,
  recheckWorld,
} from './test-support.ts';

// The `recheck-comment` job when it must not send anything (E07-S07): the stored tenant decides whether the comment is read
// at all, GitHub decides whether the installation is still served, and the comment and the pull request GitHub returns decide
// whether it is the command. Every one of them ends the job as skipped, without a retry, and sends no evaluation.

const NOT_EVALUATED = [
  ['installation_rejected', "update installations set admission_status = 'rejected'"],
  ['installation_deleted', 'update installations set deleted_at = now()'],
  ['installation_suspended', 'update installations set suspended_at = now()'],
  ['repository_removed', 'update repositories set removed_at = now()'],
  ['repository_disabled', 'update repositories set enabled = false'],
] as const;

const skippedWith = (world: RecheckWorld, reason: string) =>
  world.logs.lines().filter((line) => line['msg'] === 'recheck.skipped' && line['reason'] === reason);

test.each(NOT_EVALUATED)(
  'a tenant that is %s ends the job as skipped, logs the reason and makes no GitHub call and sends nothing',
  async (reason, statement) => {
    const world = await recheckWorld();
    await sql.raw(statement).execute(world.raw);
    expect(await world.runComment()).toEqual({ outcome: `skipped:${reason}` });
    expect(world.calls()).toEqual([]);
    expect(world.enqueuer.calls).toEqual([]);
    expect(skippedWith(world, reason)).toHaveLength(1);
  },
);

test('an installation nobody stored, and a repository the installation never had, end the job as skipped with no GitHub call', async () => {
  const world = await recheckWorld();
  expect(await world.runComment({ ...COMMENT_JOB, githubInstallationId: parseGithubId(999_999) })).toEqual({
    outcome: 'skipped:installation_not_found',
  });
  expect(await world.runComment({ ...COMMENT_JOB, githubRepoId: parseGithubId(123_456) })).toEqual({
    outcome: 'skipped:repository_not_found',
  });
  expect(world.calls()).toEqual([]);
  expect(world.enqueuer.calls).toEqual([]);
});

test('a repository GitHub no longer shows the installation ends the job as skipped before the comment is read', async () => {
  const world = await recheckWorld();
  world.fake.setRepositories(INSTALLATION, []);
  expect(await world.runComment()).toEqual({ outcome: 'skipped:repository_gone' });
  expect(world.calls()).not.toContain('getIssueComment');
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
    'it is suspended',
    (world: RecheckWorld) => {
      world.fake.suspend(INSTALLATION, new Date('2026-11-01T00:00:00Z'));
    },
  ],
  [
    'the gate refuses it',
    (world: RecheckWorld) => {
      world.gate.refuse(INSTALLATION, 'rejected');
    },
  ],
])(
  'an installation that cannot be served (%s) ends the job as skipped, without a retry and without a GitHub call',
  async (_why, apply) => {
    const world = await recheckWorld();
    apply(world);
    expect(await world.runComment()).toEqual({ outcome: 'skipped:installation_unavailable' });
    expect(world.enqueuer.calls).toEqual([]);
  },
);

test('a comment GitHub no longer has (the author deleted it) ends the job, and the pull request is not asked for', async () => {
  const world = await recheckWorld();
  expect(await world.runComment({ ...COMMENT_JOB, commentId: parseGithubId(777) })).toEqual({
    outcome: 'skipped:comment_not_found',
  });
  expect(world.calls()).toEqual(['getRepositoryById', 'getIssueComment']);
  expect(await jobCount(world.raw)).toBe(0);
});

test.each([
  ['a bot wrote it', { author: { id: parseGithubId(9), type: 'Bot' as const } }, 'bot_author'],
  ['GitHub shows no author', { author: null }, 'author_unknown'],
  ['it is on another issue than the payload names', { issueNumber: 8 }, 'comment_elsewhere'],
  ['it only mentions the command', { body: 'could you /recheck please' }, 'not_a_command'],
  ['it quotes the command', { body: '> /recheck\n\nno' }, 'not_a_command'],
  ['it shows the command in a code block', { body: 'run:\n```\n/recheck\n```' }, 'not_a_command'],
  ['it spells the command in another case', { body: '/Recheck' }, 'not_a_command'],
  ['it has no text', { body: '' }, 'not_a_command'],
] as const)(
  'a comment is refused when %s: the job ends as skipped:%s and the pull request is not asked for',
  async (_why, overrides, reason) => {
    const world = await recheckWorld();
    world.fake.addIssueComment(INSTALLATION, FULL_NAME, comment(COMMENT_ID, overrides));
    expect(await world.runComment()).toEqual({ outcome: `skipped:${reason}` });
    expect(world.calls()).toEqual(['getRepositoryById', 'getIssueComment']);
    expect(world.enqueuer.calls).toEqual([]);
    expect(skippedWith(world, reason)).toHaveLength(1);
  },
);

test('a comment on an issue that is not a pull request ends the job: the pull request GitHub has under that number is none', async () => {
  const world = await recheckWorld();
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, comment(COMMENT_ID, { issueNumber: 12 }));
  expect(await world.runComment({ ...COMMENT_JOB, prNumber: 12 })).toEqual({ outcome: 'skipped:not_pull_request' });
  expect(world.calls()).toEqual(['getRepositoryById', 'getIssueComment', 'getPullRequest']);
  expect(world.enqueuer.calls).toEqual([]);
});

test('a comment on a closed pull request ends the job, merged or not', async () => {
  const world = await recheckWorld();
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(PR_NUMBER, { state: 'closed' }));
  expect(await world.runComment()).toEqual({ outcome: 'skipped:pull_request_closed' });
  expect(world.enqueuer.calls).toEqual([]);
  expect(skippedWith(world, 'pull_request_closed')).toHaveLength(1);
});

test("the payload is a key and nothing more: a pull request number that is not the comment's is not evaluated, however open that pull request is", async () => {
  const world = await recheckWorld();
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(8));
  expect(await world.runComment({ ...COMMENT_JOB, prNumber: 8 })).toEqual({ outcome: 'skipped:comment_elsewhere' });
  expect(await jobCount(world.raw)).toBe(0);
});
