// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import {
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubResponseError,
  GitHubUnprocessableError,
} from '../../services/ports/github-errors.ts';
import { clientFixture, json, line } from './client-fixture/test-support.ts';

// What the Octokit adapter sends to list the comments of a pull request and to post one (E09-S07), and how it reads what GitHub
// can answer that a port type cannot hold. The answers both implementations give to well-formed data are in the contract suite.

const id = parseGithubId;
const LIST_ROUTE = 'GET /repos/:owner/:repo/issues/:number/comments';
const POST_ROUTE = 'POST /repos/:owner/:repo/issues/:number/comments';
const LIST_NAME = 'GET /repos/{owner}/{repo}/issues/{issue_number}/comments';
const POST_NAME = 'POST /repos/{owner}/{repo}/issues/{issue_number}/comments';

/** A comment as GitHub spells it, with fields the platform does not use. */
function commentJson(commentId: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: commentId,
    node_id: 'IC_kwDO',
    issue_url: 'https://api.github.com/repos/acme/api/issues/7',
    html_url: 'https://github.com/acme/api/pull/7#issuecomment-5001',
    body: 'text',
    user: { id: 9, login: 'cla-gate[bot]', type: 'Bot', site_admin: false },
    performed_via_github_app: { id: 4242, slug: 'cla-gate', name: 'CLA Gate' },
    created_at: '2026-11-02T09:00:00Z',
    ...overrides,
  };
}

test('a page of comments is asked for 100 to a page with the installation token, and keeps the id, the text, the author and the App', async () => {
  const { client, calls } = clientFixture({
    [LIST_ROUTE]: () => json([commentJson(5001), commentJson(5002, { performed_via_github_app: null })]),
  });
  expect(await client.listIssueComments(id(11), 'acme/api', 7, 2)).toEqual({
    comments: [
      { id: 5001, issueNumber: 7, body: 'text', author: { id: 9, type: 'Bot' }, appId: 4242 },
      { id: 5002, issueNumber: 7, body: 'text', author: { id: 9, type: 'Bot' }, appId: null },
    ],
    last: true,
  });
  expect(calls.map(line)).toEqual(['GET /repos/acme/api/issues/7/comments?per_page=100&page=2']);
  expect(calls.map((call) => call.headers.get('authorization'))).toEqual(['Bearer ghs_made-up-11-1']);
});

test.each([
  ['a next page', '<https://api.github.com/repos/acme/api/issues/7/comments?page=3>; rel="next"', false],
  ['only the previous page', '<https://api.github.com/repos/acme/api/issues/7/comments?page=1>; rel="prev"', true],
])('a page of comments with a Link header that names %s has last = %j', async (_name, link, last) => {
  const { client } = clientFixture({ [LIST_ROUTE]: () => json([commentJson(5001)], 200, { link }) });
  expect((await client.listIssueComments(id(11), 'acme/api', 7, 2)).last).toBe(last);
});

test.each([
  ['404', 404, GitHubNotFoundError],
  ['403', 403, GitHubForbiddenError],
])(
  'a page of comments that GitHub answers %s is the matching error of the port, with no body in it',
  async (_name, status, expected) => {
    const { client } = clientFixture({ [LIST_ROUTE]: () => json({ message: 'LEAKED-BODY-TEXT' }, status) });
    const failure = await client.listIssueComments(id(11), 'acme/api', 7, 1).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(expected);
    expect(String(failure)).toContain(LIST_NAME);
    expect(String(failure)).not.toContain('LEAKED');
  },
);

test('a page with a comment that is not one is a GitHubResponseError that names the route, never the answer', async () => {
  const { client } = clientFixture({ [LIST_ROUTE]: () => json([commentJson(5001), { id: 0, body: 'secret text' }]) });
  const failure = await client.listIssueComments(id(11), 'acme/api', 7, 1).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubResponseError);
  expect(failure).toMatchObject({ route: LIST_NAME });
  expect(String(failure)).not.toContain('secret');
});

test('a comment is posted with one POST that carries the installation token and the text, and nothing else, and the answer is the comment', async () => {
  const { client, calls } = clientFixture({ [POST_ROUTE]: () => json(commentJson(5009, { body: 'new text' }), 201) });
  expect(await client.createIssueComment(id(11), 'acme/api', 7, 'new text')).toEqual({
    id: 5009,
    issueNumber: 7,
    body: 'new text',
    author: { id: 9, type: 'Bot' },
    appId: 4242,
  });
  expect(calls.map(line)).toEqual(['POST /repos/acme/api/issues/7/comments']);
  expect(calls.map((call) => call.headers.get('authorization'))).toEqual(['Bearer ghs_made-up-11-1']);
  expect(JSON.parse(calls[0]?.body ?? '')).toEqual({ body: 'new text' });
});

test.each([
  ['404', 404, GitHubNotFoundError],
  ['403', 403, GitHubForbiddenError],
  ['422', 422, GitHubUnprocessableError],
])(
  'a post that GitHub answers %s is the matching error of the port, sent once, with no body in it',
  async (_name, status, expected) => {
    const { client, calls } = clientFixture({ [POST_ROUTE]: () => json({ message: 'LEAKED-BODY-TEXT' }, status) });
    const failure = await client.createIssueComment(id(11), 'acme/api', 7, 'x').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(expected);
    expect(String(failure)).toContain(POST_NAME);
    expect(String(failure)).not.toContain('LEAKED');
    expect(calls).toHaveLength(1);
  },
);

test('an answer to a post that is not a comment is a GitHubResponseError that names the route, never the answer', async () => {
  const { client } = clientFixture({ [POST_ROUTE]: () => json({ id: 0, body: 'secret text' }) });
  const failure = await client.createIssueComment(id(11), 'acme/api', 7, 'x').catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubResponseError);
  expect(failure).toMatchObject({ route: POST_NAME });
  expect(String(failure)).not.toContain('secret');
});

test('a list or a post for a repository whose name GitHub cannot hold is answered 404 without a request', async () => {
  const { client, calls } = clientFixture({});
  await expect(client.listIssueComments(id(11), '../orgs/other', 7, 1)).rejects.toBeInstanceOf(GitHubNotFoundError);
  await expect(client.createIssueComment(id(11), 'acme/api/../x', 7, 'x')).rejects.toBeInstanceOf(GitHubNotFoundError);
  expect(calls).toEqual([]);
});
