// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { commitSha } from '../../services/github-pull-contract/test-support.ts';
import {
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubResponseError,
  GitHubUnprocessableError,
} from '../../services/ports/github-errors.ts';
import { clientFixture, json, line } from './client-fixture/test-support.ts';

// What the Octokit adapter sends for the reads of the manual re-evaluation (E07-S07) and how it reads what GitHub can answer
// that a port type cannot hold: an author of a kind nobody knows, no author, a missing text, an `issue_url` without a number.
// The answers both implementations give to well-formed data are in the contract suite.

const id = parseGithubId;
const SHA = commitSha(2);
const ROUTE = 'GET /repos/{owner}/{repo}/issues/comments/{comment_id}';

/** A comment as GitHub spells it, with fields the platform does not use. */
function commentJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 5001,
    node_id: 'IC_kwDO',
    url: 'https://api.github.com/repos/acme/api/issues/comments/5001',
    html_url: 'https://github.com/acme/api/pull/7#issuecomment-5001',
    issue_url: 'https://api.github.com/repos/acme/api/issues/7',
    body: '/recheck',
    user: { id: 5, login: 'octocat', type: 'User', site_admin: false },
    author_association: 'NONE',
    created_at: '2026-11-02T09:00:00Z',
    ...overrides,
  };
}

const COMMENT_ROUTE = 'GET /repos/:owner/:repo/issues/comments/:id';
const PULLS_ROUTE = 'GET /repos/:owner/:repo/commits/:sha/pulls';

test('a comment is asked for by its id with the installation token and keeps the text, the issue number and the author id and type', async () => {
  const { client, calls } = clientFixture({ [COMMENT_ROUTE]: () => json(commentJson()) });
  expect(await client.getIssueComment(id(11), 'acme/api', id(5001))).toEqual({
    id: 5001,
    issueNumber: 7,
    body: '/recheck',
    author: { id: 5, type: 'User' },
    appId: null,
  });
  expect(calls.map(line)).toEqual(['GET /repos/acme/api/issues/comments/5001']);
  expect(calls.map((call) => call.headers.get('authorization'))).toEqual(['Bearer ghs_made-up-11-1']);
});

test.each([
  ['a bot', { id: 9, login: 'helper[bot]', type: 'Bot' }, { id: 9, type: 'Bot' }],
  ['a mannequin', { id: 9, login: 'mannequin', type: 'Mannequin' }, { id: 9, type: 'Mannequin' }],
  [
    'an enterprise account, a kind the platform has no word for',
    { id: 9, login: 'corp', type: 'Enterprise' },
    { id: 9, type: 'Other' },
  ],
  ['a type that is not text', { id: 9, login: 'corp', type: 7 }, { id: 9, type: 'Other' }],
  ['no author at all', null, null],
])('a comment by %s has the author %j', async (_name, user, author) => {
  const { client } = clientFixture({ [COMMENT_ROUTE]: () => json(commentJson({ user })) });
  expect((await client.getIssueComment(id(11), 'acme/api', id(5001)))?.author).toEqual(author);
});

test.each([
  ['an App', { performed_via_github_app: { id: 4242, slug: 'cla-gate', name: 'CLA Gate' } }, 4242],
  ['a null App, a comment a person wrote', { performed_via_github_app: null }, null],
  ['no App field at all', {}, null],
])('a comment posted through %s has the App id %j', async (_name, overrides, appId) => {
  const { client } = clientFixture({ [COMMENT_ROUTE]: () => json(commentJson(overrides)) });
  expect((await client.getIssueComment(id(11), 'acme/api', id(5001)))?.appId).toBe(appId);
});

test('a comment without a text has an empty one, which is no command', async () => {
  const withoutBody = Object.fromEntries(Object.entries(commentJson()).filter(([key]) => key !== 'body'));
  const { client } = clientFixture({ [COMMENT_ROUTE]: () => json(withoutBody) });
  expect((await client.getIssueComment(id(11), 'acme/api', id(5001)))?.body).toBe('');
});

test.each([
  ['an issue_url that names no issue', { issue_url: 'https://api.github.com/repos/acme/api/issues' }],
  ['an issue_url that ends in text', { issue_url: 'https://api.github.com/repos/acme/api/issues/seven' }],
  ['an issue_url that ends in zero', { issue_url: 'https://api.github.com/repos/acme/api/issues/0' }],
  [
    'an issue_url with a number past ten digits',
    { issue_url: 'https://api.github.com/repos/acme/api/issues/12345678901' },
  ],
  ['no issue_url', { issue_url: undefined }],
  ['an id of zero', { id: 0 }],
  ['a text that is a number', { body: 7 }],
  ['an author without a numeric id', { user: { login: 'octocat', type: 'User' } }],
  ['an App without an id', { performed_via_github_app: { slug: 'cla-gate' } }],
  ['an App id of zero', { performed_via_github_app: { id: 0 } }],
])('a comment with %s is a GitHubResponseError that names the route, never the answer', async (_name, overrides) => {
  const { client } = clientFixture({ [COMMENT_ROUTE]: () => json(commentJson(overrides)) });
  const failure = await client.getIssueComment(id(11), 'acme/api', id(5001)).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubResponseError);
  expect(failure).toMatchObject({ route: ROUTE });
  expect(failure instanceof Error && failure.message.includes('recheck')).toBe(false);
});

test('a comment GitHub answers 404 to is null, and a 403 is a refusal', async () => {
  const { client } = clientFixture({
    [COMMENT_ROUTE]: (call) =>
      call.path.endsWith('/5001') ? json({ message: 'Not Found' }, 404) : json({ message: 'Forbidden' }, 403),
  });
  expect(await client.getIssueComment(id(11), 'acme/api', id(5001))).toBeNull();
  await expect(client.getIssueComment(id(11), 'acme/api', id(5002))).rejects.toBeInstanceOf(GitHubForbiddenError);
});

test('the pull requests of a commit are asked for 100 to a page and keep the number, the state and the head SHA, wherever the head lives', async () => {
  const forked = { number: 9, state: 'open', head: { sha: SHA, ref: 'feature', repo: { full_name: 'forker/api' } } };
  const closed = { number: 4, state: 'closed', head: { sha: commitSha(7), ref: 'old', repo: null } };
  const { client, calls } = clientFixture({ [PULLS_ROUTE]: () => json([forked, closed]) });
  expect(await client.listPullRequestsForCommit(id(11), 'acme/api', SHA)).toEqual([
    { number: 9, state: 'open', headSha: SHA },
    { number: 4, state: 'closed', headSha: commitSha(7) },
  ]);
  expect(calls.map(line)).toEqual([`GET /repos/acme/api/commits/${SHA}/pulls?per_page=100`]);
  expect(calls.map((call) => call.headers.get('authorization'))).toEqual(['Bearer ghs_made-up-11-1']);
});

test.each([
  ['a state that is neither open nor closed', { number: 7, state: 'merged', head: { sha: SHA } }],
  ['a head that is not a commit SHA', { number: 7, state: 'open', head: { sha: 'main' } }],
  ['a number of zero', { number: 0, state: 'open', head: { sha: SHA } }],
  ['no head', { number: 7, state: 'open' }],
])('a listing with a pull request with %s is a GitHubResponseError that names the route', async (_name, entry) => {
  const { client } = clientFixture({ [PULLS_ROUTE]: () => json([entry]) });
  await expect(client.listPullRequestsForCommit(id(11), 'acme/api', SHA)).rejects.toMatchObject({
    route: 'GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls',
  });
});

test('a commit GitHub answers 404 to has no pull requests, and a 403 is a refusal', async () => {
  const { client } = clientFixture({
    [PULLS_ROUTE]: (call) =>
      call.path.includes(SHA) ? json({ message: 'Not Found' }, 404) : json({ message: 'Forbidden' }, 403),
  });
  expect(await client.listPullRequestsForCommit(id(11), 'acme/api', SHA)).toEqual([]);
  await expect(client.listPullRequestsForCommit(id(11), 'acme/api', commitSha(3))).rejects.toBeInstanceOf(
    GitHubForbiddenError,
  );
});

test('what no request can carry never reaches the network: a name or a SHA that GitHub cannot hold is answered without one', async () => {
  const { client, calls } = clientFixture({});
  expect(await client.getIssueComment(id(11), '../orgs/other', id(5001))).toBeNull();
  expect(await client.listPullRequestsForCommit(id(11), 'acme/api/../x', SHA)).toEqual([]);
  expect(await client.listPullRequestsForCommit(id(11), 'acme/api', 'main?x=1')).toEqual([]);
  expect(await client.listPullRequestsForCommit(id(11), 'acme/api', `${SHA}/../x`)).toEqual([]);
  expect(calls).toEqual([]);
});

const PATCH_ROUTE = 'PATCH /repos/:owner/:repo/issues/comments/:id';

test('a comment is rewritten with one PATCH that carries the installation token and the text, and nothing else, and the answer is the comment as it reads now', async () => {
  const { client, calls } = clientFixture({ [PATCH_ROUTE]: () => json(commentJson({ body: 'new text' })) });
  expect(await client.updateIssueComment(id(11), 'acme/api', id(5001), 'new text')).toEqual({
    id: 5001,
    issueNumber: 7,
    body: 'new text',
    author: { id: 5, type: 'User' },
    appId: null,
  });
  expect(calls.map(line)).toEqual(['PATCH /repos/acme/api/issues/comments/5001']);
  expect(calls.map((call) => call.headers.get('authorization'))).toEqual(['Bearer ghs_made-up-11-1']);
  expect(JSON.parse(calls[0]?.body ?? '')).toEqual({ body: 'new text' });
});

test.each([
  ['404', 404, GitHubNotFoundError],
  ['403', 403, GitHubForbiddenError],
  ['422', 422, GitHubUnprocessableError],
])(
  'a rewrite that GitHub answers %s is the matching error of the port, sent once, with no body in it',
  async (_name, status, expected) => {
    const { client, calls } = clientFixture({ [PATCH_ROUTE]: () => json({ message: 'LEAKED-BODY-TEXT' }, status) });
    const failure = await client.updateIssueComment(id(11), 'acme/api', id(5001), 'x').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(expected);
    expect(String(failure)).toContain('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}');
    expect(String(failure)).not.toContain('LEAKED');
    expect(calls).toHaveLength(1);
  },
);

test('an answer to a rewrite that is not a comment is a GitHubResponseError that names the route, never the answer', async () => {
  const { client } = clientFixture({ [PATCH_ROUTE]: () => json({ id: 0, body: 'secret text' }) });
  const failure = await client.updateIssueComment(id(11), 'acme/api', id(5001), 'x').catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubResponseError);
  expect(failure).toMatchObject({ route: 'PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}' });
  expect(String(failure)).not.toContain('secret');
});

test('a rewrite of a comment of a repository whose name GitHub cannot hold is answered 404 without a request', async () => {
  const { client, calls } = clientFixture({});
  await expect(client.updateIssueComment(id(11), '../orgs/other', id(5001), 'x')).rejects.toBeInstanceOf(
    GitHubNotFoundError,
  );
  expect(calls).toEqual([]);
});
