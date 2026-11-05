// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { commitSha } from '../../services/github-pull-contract/test-support.ts';
import {
  GitHubForbiddenError,
  GitHubRateLimitedError,
  GitHubResponseError,
  GitHubUnavailableError,
} from '../../services/ports/github-errors.ts';
import { clientFixture, json, line } from './client-fixture/test-support.ts';

// What the Octokit adapter sends to find out whether a repository has a commit (E15-S05) and how it reads what GitHub can answer: a 404
// and a 422 are "no such commit", every other failure is a failure. The answers both implementations give to well-formed data are in
// the contract suite (`getCommit`).

const id = parseGithubId;
const SHA = commitSha(10);
const ROUTE = 'GET /repos/:owner/:repo/commits/:ref';

test('the commit is asked for by its full SHA with the installation token, and only its SHA is read of the answer', async () => {
  const { client, calls } = clientFixture({
    [ROUTE]: () =>
      json({
        sha: SHA,
        node_id: 'MDY6Q29tbWl0',
        parents: [{ sha: commitSha(9) }],
        commit: { message: 'a message nobody reads' },
        files: [{ filename: 'README.md', patch: '@@ -1 +1 @@' }],
      }),
  });
  expect(await client.getCommit(id(11), 'acme/api', SHA)).toEqual({ sha: SHA });
  expect(calls.map(line)).toEqual([`GET /repos/acme/api/commits/${SHA}`]);
  expect(calls.map((call) => call.headers.get('authorization'))).toEqual(['Bearer ghs_made-up-11-1']);
});

test.each([
  ['404, a repository or commit GitHub does not show', 404],
  ['422, a SHA that no commit of the repository has', 422],
])('a %s is null and is not repeated', async (_name, status) => {
  const { client, calls, waits } = clientFixture({ [ROUTE]: () => json({ message: 'No commit found' }, status) });
  expect(await client.getCommit(id(11), 'acme/api', SHA)).toBeNull();
  expect([calls.length, waits]).toEqual([1, []]);
});

test('a 403 that is a refusal is GitHubForbiddenError: a missing permission is not a missing commit', async () => {
  const { client } = clientFixture({
    [ROUTE]: () =>
      json({ message: 'Resource not accessible by integration' }, 403, { 'x-ratelimit-remaining': '4990' }),
  });
  await expect(client.getCommit(id(11), 'acme/api', SHA)).rejects.toBeInstanceOf(GitHubForbiddenError);
});

test('a rate limit too long to wait out is GitHubRateLimitedError, and a server error is GitHubUnavailableError', async () => {
  const limited = clientFixture({ [ROUTE]: () => json({ message: 'slow down' }, 429, { 'retry-after': '120' }) });
  await expect(limited.client.getCommit(id(11), 'acme/api', SHA)).rejects.toMatchObject({
    name: GitHubRateLimitedError.name,
    retryAfterSeconds: 120,
  });
  const down = clientFixture({ [ROUTE]: () => json({ message: 'boom' }, 500) });
  await expect(down.client.getCommit(id(11), 'acme/api', SHA)).rejects.toBeInstanceOf(GitHubUnavailableError);
});

test.each([
  ['no SHA', { parents: [] }],
  ['a SHA that is not one', { sha: 'zzzz-leak' }],
  ['a SHA in upper case', { sha: 'ABCDEF'.padEnd(40, '0') }],
  ['a list for an answer', []],
])('an answer with %s is a GitHubResponseError that names the route, never the answer', async (_name, body) => {
  const { client } = clientFixture({ [ROUTE]: () => json(body) });
  const failure = await client.getCommit(id(11), 'acme/api', SHA).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubResponseError);
  expect(failure).toMatchObject({ route: 'GET /repos/{owner}/{repo}/commits/{ref}' });
  expect(failure instanceof Error && failure.message.includes('zzzz-leak')).toBe(false);
});

test('what no request can carry never reaches the network: a name that GitHub cannot hold, a branch and an abbreviation are answered without one', async () => {
  const { client, calls } = clientFixture({});
  expect(await client.getCommit(id(11), '../orgs/other', SHA)).toBeNull();
  expect(await client.getCommit(id(11), 'acme/api', 'main')).toBeNull();
  expect(await client.getCommit(id(11), 'acme/api', SHA.slice(0, 7))).toBeNull();
  expect(await client.getCommit(id(11), 'acme/api', SHA.toUpperCase())).toBeNull();
  expect(await client.getCommit(id(11), 'acme/api', `${SHA}/../x`)).toBeNull();
  expect(calls).toEqual([]);
});
