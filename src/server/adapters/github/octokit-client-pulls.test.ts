// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { commitSha, pullRequest } from '../../services/github-pull-contract/test-support.ts';
import { GitHubForbiddenError, GitHubNotFoundError, GitHubResponseError } from '../../services/ports/github-errors.ts';
import { clientFixture, json, line } from './client-fixture/test-support.ts';

// What the Octokit adapter sends for the reads of the evaluation job (E07-S10) and how it reads what GitHub can answer
// that a port type cannot hold: the shapes of an unlinked identity, an answer that is not what the schema says, the
// `Link` header that ends a listing. The answers both implementations give to well-formed data are in the contract suite.

const id = parseGithubId;
const SHA = commitSha(2);

/** A commit as GitHub spells it, with the linked accounts `author` and `committer` as the test gives them. */
function commitJson(author: unknown, committer: unknown = null): Record<string, unknown> {
  return {
    sha: SHA,
    node_id: 'MDY6Q29tbWl0',
    parents: [{ sha: commitSha(1), url: 'https://api.github.com/x' }],
    author,
    committer,
    commit: {
      message: 'change 2',
      author: { name: 'Author 2', email: 'author2@example.org', date: '2026-11-01T09:00:00Z' },
      committer: { name: 'Author 2', email: 'author2@example.org', date: '2026-11-01T09:00:00Z' },
      tree: { sha: commitSha(99) },
    },
  };
}

const LINKED = { id: 5, login: 'octocat', type: 'User', site_admin: false, node_id: 'MDQ6VXNlcjU=' };

const PULL = {
  number: 7,
  state: 'open',
  draft: false,
  head: { sha: SHA, ref: 'feature' },
  base: { sha: commitSha(1), ref: 'main' },
  user: LINKED,
  commits: 2,
  title: 'A title',
};

test.each([
  ['null', null],
  ['an empty object', {}],
  ['no id', { login: 'octocat', type: 'User' }],
  ['an id that is a string', { ...LINKED, id: '5' }],
  ['an id of zero', { ...LINKED, id: 0 }],
  ['a type nobody knows', { ...LINKED, type: 'Enterprise' }],
  ['no login', { id: 5, type: 'User' }],
  ['something that is not an object', 'octocat'],
])('a commit author that is %s is an unlinked identity, never an account', async (_name, author) => {
  const { client } = clientFixture({
    'GET /repos/:owner/:repo/pulls/:number/commits': () => json([commitJson(author, LINKED)]),
  });
  const page = await client.listPullRequestCommits(id(11), 'acme/api', 7, 1);
  expect(page.commits[0]).toMatchObject({ author: null, committer: { id: 5, login: 'octocat', type: 'User' } });
});

test('a commit whose author and committer keys are absent has no linked identity either', async () => {
  const { client } = clientFixture({
    'GET /repos/:owner/:repo/pulls/:number/commits': () => {
      const bare = Object.entries(commitJson(null)).filter(([key]) => key !== 'author' && key !== 'committer');
      return json([Object.fromEntries(bare)]);
    },
  });
  const page = await client.listPullRequestCommits(id(11), 'acme/api', 7, 1);
  expect(page.commits[0]).toMatchObject({ author: null, committer: null });
});

test('a linked account keeps its id, login and type and nothing else, and a commit keeps what the evaluation reads', async () => {
  const { client } = clientFixture({
    'GET /repos/:owner/:repo/pulls/:number/commits': () => json([commitJson(LINKED)]),
  });
  const page = await client.listPullRequestCommits(id(11), 'acme/api', 7, 1);
  expect(page.commits).toEqual([
    {
      sha: SHA,
      parents: [commitSha(1)],
      author: { id: 5, login: 'octocat', type: 'User' },
      committer: null,
      message: 'change 2',
      rawAuthor: { name: 'Author 2', email: 'author2@example.org' },
      rawCommitter: { name: 'Author 2', email: 'author2@example.org' },
    },
  ]);
});

test('the pages are asked for by number, 100 to a page, with the installation token, and the Link header says whether one follows', async () => {
  const next = '<https://api.github.com/x?page=3>; rel="next", <https://api.github.com/x?page=9>; rel="last"';
  const { client, calls } = clientFixture({
    'GET /repos/:owner/:repo/pulls/:number/commits': (call) =>
      json([], 200, new URLSearchParams(call.search).get('page') === '2' ? { link: next } : {}),
    'GET /repos/:owner/:repo/commits': () => json([], 200, { link: '<https://api.github.com/x>; rel="prev"' }),
  });
  expect((await client.listPullRequestCommits(id(11), 'acme/api', 7, 2)).last).toBe(false);
  expect((await client.listPullRequestCommits(id(11), 'acme/api', 7, 3)).last).toBe(true);
  expect((await client.listRepositoryCommits(id(11), 'acme/api', SHA, 1)).last).toBe(true);
  expect(calls.map(line)).toEqual([
    'GET /repos/acme/api/pulls/7/commits?per_page=100&page=2',
    'GET /repos/acme/api/pulls/7/commits?per_page=100&page=3',
    `GET /repos/acme/api/commits?sha=${SHA}&per_page=100&page=1`,
  ]);
  expect(calls.map((call) => call.headers.get('authorization'))).toEqual(Array(3).fill('Bearer ghs_made-up-11-1'));
});

test('the comparison is asked for with the two SHAs, and its merge base is the only thing read of it', async () => {
  const { client, calls } = clientFixture({
    'GET /repos/:owner/:repo/compare/:basehead': () =>
      json({ status: 'diverged', ahead_by: 3, merge_base_commit: { sha: commitSha(4), commit: {} } }),
  });
  expect(await client.compareCommits(id(11), 'acme/api', commitSha(9), SHA)).toEqual({ mergeBaseSha: commitSha(4) });
  expect(calls.map(line)).toEqual([`GET /repos/acme/api/compare/${commitSha(9)}...${SHA}`]);
});

test('a pull request keeps the fields the evaluation reads, and a missing draft flag is not a draft', async () => {
  const withoutDraft = Object.fromEntries(Object.entries(PULL).filter(([key]) => key !== 'draft'));
  const { client, calls } = clientFixture({ 'GET /repos/:owner/:repo/pulls/:number': () => json(withoutDraft) });
  expect(await client.getPullRequest(id(11), 'acme/api', 7)).toEqual(
    pullRequest(7, { opener: { id: id(5), login: 'octocat', type: 'User' } }),
  );
  expect(calls.map(line)).toEqual(['GET /repos/acme/api/pulls/7']);
});

test.each([
  ['an opener without an account', { ...PULL, user: null }],
  ['a state that is neither open nor closed', { ...PULL, state: 'merged' }],
  ['a head that is not a commit SHA', { ...PULL, head: { sha: 'main' } }],
  ['a commit count that is not a number', { ...PULL, commits: '2' }],
])('a pull request with %s is a GitHubResponseError that names the route, never the answer', async (_name, body) => {
  const { client } = clientFixture({ 'GET /repos/:owner/:repo/pulls/:number': () => json(body) });
  const failure = await client.getPullRequest(id(11), 'acme/api', 7).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubResponseError);
  expect(failure).toMatchObject({ route: 'GET /repos/{owner}/{repo}/pulls/{pull_number}' });
  expect(failure instanceof Error && failure.message.includes('merged')).toBe(false);
});

test.each([
  ['a message that is not text', { ...commitJson(LINKED), commit: { message: 7, author: {}, committer: {} } }],
  ['a parent that is not a SHA', { ...commitJson(LINKED), parents: [{ sha: 'HEAD' }] }],
  ['a SHA in upper case', { ...commitJson(LINKED), sha: SHA.toUpperCase().replace(/^0+/, 'ABCDEF') }],
])('a listing with a commit with %s is a GitHubResponseError that names the route', async (_name, body) => {
  const { client } = clientFixture({ 'GET /repos/:owner/:repo/pulls/:number/commits': () => json([body]) });
  await expect(client.listPullRequestCommits(id(11), 'acme/api', 7, 1)).rejects.toMatchObject({
    route: 'GET /repos/{owner}/{repo}/pulls/{pull_number}/commits',
  });
});

test('a pull request GitHub answers 404 to is null, a listing it answers 404 to is a GitHubNotFoundError, a 403 is a refusal', async () => {
  const { client } = clientFixture({
    'GET /repos/:owner/:repo/pulls/:number': () => json({ message: 'Not Found' }, 404),
    'GET /repos/:owner/:repo/pulls/:number/commits': () => json({ message: 'Not Found' }, 404),
    'GET /repos/:owner/:repo/commits': () => json({ message: 'Resource not accessible by integration' }, 403),
  });
  expect(await client.getPullRequest(id(11), 'acme/api', 7)).toBeNull();
  await expect(client.listPullRequestCommits(id(11), 'acme/api', 7, 1)).rejects.toBeInstanceOf(GitHubNotFoundError);
  await expect(client.listRepositoryCommits(id(11), 'acme/api', SHA, 1)).rejects.toBeInstanceOf(GitHubForbiddenError);
});

test('what no request can carry never reaches the network: a name or a SHA that GitHub cannot hold is answered without one', async () => {
  const { client, calls } = clientFixture({});
  expect(await client.getPullRequest(id(11), '../orgs/other', 7)).toBeNull();
  await expect(client.listPullRequestCommits(id(11), 'acme/api/../x', 7, 1)).rejects.toBeInstanceOf(
    GitHubNotFoundError,
  );
  await expect(client.listRepositoryCommits(id(11), 'acme/api', 'main?x=1', 1)).rejects.toBeInstanceOf(
    GitHubNotFoundError,
  );
  await expect(client.compareCommits(id(11), 'acme/api', SHA, '../x')).rejects.toBeInstanceOf(GitHubNotFoundError);
  expect(calls).toEqual([]);
});
