// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { commitSha } from '../../services/github-pull-contract/test-support.ts';
import {
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubRateLimitedError,
} from '../../services/ports/github-errors.ts';
import { clientFixture, json, line } from './client-fixture/test-support.ts';

// What the Octokit adapter sends for the listing of the open pull requests of a repository (E07-S08) and how it reads what
// GitHub can answer that a port type cannot hold. The answers both implementations give to well-formed data are in the
// contract suite.

const id = parseGithubId;
const SHA = commitSha(2);
const ROUTE = 'GET /repos/:owner/:repo/pulls';
const ROUTE_TEMPLATE = 'GET /repos/{owner}/{repo}/pulls';

/** A pull request of a listing as GitHub spells it, with fields the platform does not use. */
const listed = (number: number, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 1_000_000 + number,
  number,
  state: 'open',
  title: 'A title the platform never reads',
  user: { id: 5, login: 'octocat', type: 'User' },
  head: { sha: SHA, ref: 'feature', repo: { full_name: 'forker/api', fork: true } },
  base: { sha: commitSha(1), ref: 'main' },
  draft: false,
  ...overrides,
});

test('the open pull requests are asked for 100 to a page, newest first, with the installation token, and keep the number, state and head SHA', async () => {
  const { client, calls } = clientFixture({ [ROUTE]: () => json([listed(9), listed(7)]) });
  expect(await client.listOpenPullRequests(id(11), 'acme/api', 2)).toEqual({
    pulls: [
      { number: 9, state: 'open', headSha: SHA },
      { number: 7, state: 'open', headSha: SHA },
    ],
    last: true,
  });
  expect(calls.map(line)).toEqual([
    'GET /repos/acme/api/pulls?state=open&sort=created&direction=desc&per_page=100&page=2',
  ]);
  expect(calls.map((call) => call.headers.get('authorization'))).toEqual(['Bearer ghs_made-up-11-1']);
});

test('a Link that names a next page makes the page not the last, and one without it makes it the last', async () => {
  const next = '<https://api.github.com/repositories/101/pulls?state=open&page=2>; rel="next"';
  const { client } = clientFixture({
    [ROUTE]: (call) => json([listed(9)], 200, call.search.includes('page=2') ? {} : { link: next }),
  });
  expect((await client.listOpenPullRequests(id(11), 'acme/api', 1)).last).toBe(false);
  expect((await client.listOpenPullRequests(id(11), 'acme/api', 2)).last).toBe(true);
});

test.each([
  ['a state that is neither open nor closed', listed(7, { state: 'merged' })],
  ['a head that is not a commit SHA', listed(7, { head: { sha: 'main' } })],
  ['a number of zero', listed(0)],
  ['no head', listed(7, { head: undefined })],
])(
  'a listing with a pull request with %s is a GitHubResponseError that names the route, never the answer',
  async (_name, entry) => {
    const { client } = clientFixture({ [ROUTE]: () => json([entry]) });
    const failure = await client.listOpenPullRequests(id(11), 'acme/api', 1).catch((error: unknown) => error);
    expect(failure).toMatchObject({ name: 'GitHubResponseError', route: ROUTE_TEMPLATE });
    expect(failure instanceof Error && failure.message.includes('octocat')).toBe(false);
  },
);

test('an answer that is not a list is a GitHubResponseError too', async () => {
  const { client } = clientFixture({ [ROUTE]: () => json({ message: 'a list was expected' }) });
  await expect(client.listOpenPullRequests(id(11), 'acme/api', 1)).rejects.toMatchObject({ route: ROUTE_TEMPLATE });
});

test('a repository GitHub answers 404 to is a GitHubNotFoundError, a 403 is a refusal, and a limit too long to wait out is a rate limit', async () => {
  const { client } = clientFixture({
    [ROUTE]: (call) => {
      if (call.path.includes('/acme/gone/')) {
        return json({ message: 'Not Found' }, 404);
      }
      return call.path.includes('/acme/blocked/')
        ? json({ message: 'Repository access blocked' }, 403)
        : json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'retry-after': '3600' });
    },
  });
  await expect(client.listOpenPullRequests(id(11), 'acme/gone', 1)).rejects.toBeInstanceOf(GitHubNotFoundError);
  await expect(client.listOpenPullRequests(id(11), 'acme/blocked', 1)).rejects.toBeInstanceOf(GitHubForbiddenError);
  await expect(client.listOpenPullRequests(id(11), 'acme/limited', 1)).rejects.toBeInstanceOf(GitHubRateLimitedError);
});

test('what no request can carry never reaches the network: a name GitHub cannot hold is a GitHubNotFoundError without one', async () => {
  const { client, calls } = clientFixture({});
  for (const name of ['acme', '../orgs/other', 'acme/api/../x', 'acme/..']) {
    await expect(client.listOpenPullRequests(id(11), name, 1)).rejects.toBeInstanceOf(GitHubNotFoundError);
  }
  expect(calls).toEqual([]);
});
