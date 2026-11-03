// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import {
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubRateLimitedError,
  GitHubUnavailableError,
  GitHubUnprocessableError,
} from '../ports/github-errors.ts';
import { FAILING, FULL_NAME, HEAD, INSTALLATION, MARKER, NAMES, ours, reportingWorld } from './test-support.ts';

// What the pull request comment does with what GitHub answers (E09-S07), with failures injected into FakeGitHub: a 403, a 404 or a 422
// on the conversation costs the comment only (`comment_skipped` with the status), the Check Run is always written first and is not
// changed; a rate limit and an outage are thrown unchanged for the queue to retry, after the Check Run was written.

const COMMENT = 5001;
const ROUTE = 'a route';

/** A world with a stored comment 5001 that the fake holds, and the target of a failing report. */
async function commented() {
  const world = await reportingWorld();
  const target = await world.evaluation({ commentId: COMMENT });
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, ours(COMMENT));
  return { world, target };
}

test.each([
  ['a 403 on the listing', 'listIssueComments', new GitHubForbiddenError(ROUTE), 403],
  ['a 404 on the listing', 'listIssueComments', new GitHubNotFoundError(ROUTE), 404],
  ['a 403 on the post', 'createIssueComment', new GitHubForbiddenError(ROUTE), 403],
  ['a 404 on the post', 'createIssueComment', new GitHubNotFoundError(ROUTE), 404],
  ['a 422 on the post (a locked conversation)', 'createIssueComment', new GitHubUnprocessableError(ROUTE), 422],
] as const)(
  '%s logs comment_skipped with the status, reports, and leaves the written Check Run and the row as they are',
  async (_name, method, error, status) => {
    const world = await reportingWorld();
    const target = await world.evaluation();
    world.fake.failNext(method, error);
    expect(await world.reporter.publish(target, FAILING, NAMES)).toEqual({ status: 'reported' });
    expect(world.fake.checkRuns).toHaveLength(1);
    expect(world.fake.checkRuns[0]?.write).toMatchObject({ status: 'completed', conclusion: 'failure' });
    expect(world.logs.lines().find((entry) => entry['msg'] === 'comment_skipped')).toMatchObject({
      githubInstallationId: INSTALLATION,
      prNumber: 7,
      headSha: HEAD,
      statusCode: status,
    });
    expect((await world.rows()).map((row) => row.comment_id)).toEqual([null]);
    expect((await world.rows()).map((row) => row.check_run_id)).toEqual([world.fake.checkRuns[0]?.run.id]);
    expect(world.logs.text()).not.toMatch(/octocat|Sign the CLA|cla-platform/u);
  },
);

test.each([
  ['a 403 on the edit', new GitHubForbiddenError(ROUTE), 403],
  ['a 422 on the edit', new GitHubUnprocessableError(ROUTE), 422],
] as const)(
  '%s of the stored comment logs comment_skipped, reports, and keeps the stored id',
  async (_name, error, status) => {
    const { world, target } = await commented();
    world.fake.failNext('updateIssueComment', error);
    expect(await world.reporter.publish(target, FAILING, NAMES)).toEqual({ status: 'reported' });
    expect(world.logs.lines().find((entry) => entry['msg'] === 'comment_skipped')).toMatchObject({
      statusCode: status,
    });
    expect((await world.rows()).map((row) => row.comment_id)).toEqual([COMMENT]);
    expect((await world.fake.getIssueComment(INSTALLATION, FULL_NAME, parseGithubId(COMMENT)))?.body).toBe(
      `${MARKER}\nold text`,
    );
  },
);

test('a 404 on the edit that found the comment by the listing (it vanished between the two calls) logs comment_skipped 404', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, ours(COMMENT));
  world.fake.failNext('updateIssueComment', new GitHubNotFoundError(ROUTE));
  expect(await world.reporter.publish(target, FAILING, NAMES)).toEqual({ status: 'reported' });
  expect(world.logs.lines().find((entry) => entry['msg'] === 'comment_skipped')).toMatchObject({ statusCode: 404 });
  expect((await world.rows()).map((row) => row.comment_id)).toEqual([null]);
});

test.each([
  ['the listing', 'listIssueComments'],
  ['the post', 'createIssueComment'],
] as const)(
  'a rate limit of 120 seconds on %s is thrown unchanged, after the Check Run was written',
  async (_name, method) => {
    const world = await reportingWorld();
    const target = await world.evaluation();
    const limit = new GitHubRateLimitedError(120, 'secondary');
    world.fake.failNext(method, limit);
    await expect(world.reporter.publish(target, FAILING, NAMES)).rejects.toBe(limit);
    expect(world.fake.checkRuns[0]?.write).toMatchObject({ conclusion: 'failure' });
    expect((await world.rows()).map((row) => row.comment_id)).toEqual([null]);
  },
);

test.each([
  ['the listing', 'listIssueComments'],
  ['the post', 'createIssueComment'],
] as const)('an outage on %s is thrown unchanged, after the Check Run was written', async (_name, method) => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  const outage = new GitHubUnavailableError('GitHub answered 502');
  world.fake.failNext(method, outage);
  await expect(world.reporter.publish(target, FAILING, NAMES)).rejects.toBe(outage);
  expect(world.fake.checkRuns[0]?.write).toMatchObject({ conclusion: 'failure' });
});

test.each([
  ['a rate limit', new GitHubRateLimitedError(30, 'primary')],
  ['an outage', new GitHubUnavailableError('GitHub answered 503')],
])('%s on the edit of the stored comment is thrown unchanged', async (_name, error) => {
  const { world, target } = await commented();
  world.fake.failNext('updateIssueComment', error);
  await expect(world.reporter.publish(target, FAILING, NAMES)).rejects.toBe(error);
  expect(world.fake.checkRuns[0]?.write).toMatchObject({ conclusion: 'failure' });
});

test('a job retried after a rate limit on the post finishes the work: one run, one comment', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  world.fake.failNext('createIssueComment', new GitHubRateLimitedError(30, 'primary'));
  await expect(world.reporter.publish(target, FAILING, NAMES)).rejects.toBeInstanceOf(GitHubRateLimitedError);
  await world.reporter.publish(target, FAILING, NAMES);
  const { comments } = await world.fake.listIssueComments(INSTALLATION, FULL_NAME, 7, 1);
  expect(comments).toHaveLength(1);
  expect(world.fake.checkRuns).toHaveLength(1);
  expect((await world.rows()).map((row) => row.comment_id)).toEqual([comments[0]?.id]);
});
