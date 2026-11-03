// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { comment } from '../github-comment-contract/test-support.ts';
import { GitHubRateLimitedError, GitHubUnavailableError } from '../ports/github-errors.ts';
import { adapterWorld } from './adapter-world/test-support.ts';
import { COMMENT_POST, COMMENTS, refused, scripted } from './scripted-github/test-support.ts';
import { APP, FAILING, FULL_NAME, INSTALLATION, MARKER, NAMES, ours } from './test-support.ts';

// The pull request comment on the real Octokit adapter, over HTTP with MSW (E09-S07): the requests the reporter makes to find, edit
// and open the comment, in order and page by page, the App that GitHub names for a comment, and the statuses GitHub refuses it with
// as the adapter turns them into errors of the port.

const page = (n: number) => `GET /repos/${FULL_NAME}/issues/7/comments?per_page=100&page=${n}`;
const POSTED = `POST /repos/${FULL_NAME}/issues/7/comments`;
const REJECTION = refused(422);

test('a failure lists the conversation and posts one comment, and the next one edits it by its id with one PATCH', async () => {
  const { world, github, checkRequests } = await adapterWorld();
  const target = await world.evaluation();
  await world.reporter.publish(target, FAILING, NAMES);
  await world.reporter.publish(target, FAILING, NAMES);
  expect(checkRequests().filter((request) => request.includes('/issues/'))).toEqual([
    page(1),
    POSTED,
    `PATCH /repos/${FULL_NAME}/issues/comments/8000001`,
  ]);
  const { comments } = await github.client.listIssueComments(INSTALLATION, FULL_NAME, 7, 1);
  expect(comments).toHaveLength(1);
  expect(comments[0]).toMatchObject({ id: 8_000_001, appId: APP, author: { type: 'Bot' } });
  expect(comments[0]?.body.startsWith(`${MARKER}\n## CLA check failed`)).toBe(true);
  expect((await world.rows()).map((row) => row.comment_id)).toEqual([8_000_001]);
});

test('the App GitHub names for a comment decides: a forged comment with the marker is ignored, ours is edited', async () => {
  const { world, github, checkRequests } = await adapterWorld();
  const target = await world.evaluation();
  github.addIssueComment(
    INSTALLATION,
    FULL_NAME,
    ours(5001, { appId: null, author: { id: parseGithubId(5), type: 'User' } }),
  );
  github.addIssueComment(INSTALLATION, FULL_NAME, ours(5002));
  await world.reporter.publish(target, FAILING, NAMES);
  expect(checkRequests().filter((request) => request.includes('/issues/'))).toEqual([
    page(1),
    `PATCH /repos/${FULL_NAME}/issues/comments/5002`,
  ]);
  expect((await github.client.getIssueComment(INSTALLATION, FULL_NAME, parseGithubId(5001)))?.body).toBe(
    `${MARKER}\nold text`,
  );
  expect((await world.rows()).map((row) => row.comment_id)).toEqual([5002]);
});

test('six pages of unrelated comments are read as five requests, page 1 to 5, and then the comment is posted', async () => {
  const { world, github, checkRequests } = await adapterWorld();
  const target = await world.evaluation();
  for (let id = 6001; id <= 6600; id += 1) {
    github.addIssueComment(INSTALLATION, FULL_NAME, comment(id));
  }
  await world.reporter.publish(target, FAILING, NAMES);
  expect(checkRequests().filter((request) => request.includes('/issues/'))).toEqual([
    page(1),
    page(2),
    page(3),
    page(4),
    page(5),
    POSTED,
  ]);
});

test('a stored comment that GitHub answers 404 to is recreated through the adapter, and the new id is stored', async () => {
  const { world, checkRequests } = await adapterWorld();
  const target = await world.evaluation({ commentId: 5001 });
  await world.reporter.publish(target, FAILING, NAMES);
  expect(checkRequests().filter((request) => request.includes('/issues/'))).toEqual([
    `PATCH /repos/${FULL_NAME}/issues/comments/5001`,
    page(1),
    POSTED,
  ]);
  expect((await world.rows()).map((row) => row.comment_id)).toEqual([8_000_001]);
});

test.each([
  ['403 on the listing', COMMENTS, 403],
  ['404 on the listing', COMMENTS, 404],
  ['403 on the post', COMMENT_POST, 403],
  ['404 on the post', COMMENT_POST, 404],
  ['422 on the post', COMMENT_POST, 422],
] as const)(
  'a %s costs the comment only: skipped with the status, the run written, no body in any log',
  async (_name, route, status) => {
    const { world } = await scripted({ [route]: refused(status) });
    const target = await world.evaluation();
    expect(await world.reporter.publish(target, FAILING, NAMES)).toEqual({ status: 'reported' });
    expect(world.logs.lines().find((entry) => entry['msg'] === 'comment_skipped')).toMatchObject({
      statusCode: status,
    });
    expect((await world.rows()).map((row) => [row.comment_id, row.check_run_id])).toEqual([[null, 9_000_001]]);
    expect(world.logs.text()).not.toContain('LEAKED');
  },
);

test('a rate limit of 120 seconds on the listing is thrown with its 120 seconds for the queue to retry, after the run was written', async () => {
  const { world } = await scripted({ [COMMENTS]: refused(429, { 'retry-after': '120' }) });
  const target = await world.evaluation();
  const failure = await world.reporter.publish(target, FAILING, NAMES).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubRateLimitedError);
  expect(failure).toMatchObject({ retryAfterSeconds: 120 });
  expect((await world.rows()).map((row) => row.check_run_id)).toEqual([9_000_001]);
});

test('an outage on the post is thrown unchanged for the queue to retry, after the run was written', async () => {
  const { world } = await scripted({ [COMMENT_POST]: refused(502) });
  const target = await world.evaluation();
  await expect(world.reporter.publish(target, FAILING, NAMES)).rejects.toBeInstanceOf(GitHubUnavailableError);
  expect((await world.rows()).map((row) => row.check_run_id)).toEqual([9_000_001]);
});

test('a 422 on the post is not retried with another body: the post is sent once', async () => {
  const { world, calls } = await scripted({ [COMMENT_POST]: REJECTION });
  const target = await world.evaluation();
  await world.reporter.publish(target, FAILING, NAMES);
  expect(calls.filter((call) => call.path.endsWith('/issues/7/comments') && call.method === 'POST')).toHaveLength(1);
});
