// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { GitHubResponseError } from '../../services/ports/github-errors.ts';
import { clientFixture, json, line, type RouteCall, repositoryJson } from './client-fixture/test-support.ts';

const id = parseGithubId;
const NEXT_HOST = 'https://api.github.com';

/** Page `n` of `pages` for `GET /installation/repositories`: one repository per page, a Link to the next. */
function repositoryPages(pages: number, nextOrigin = NEXT_HOST): (call: RouteCall) => Response {
  return (call) => {
    const page = Number(new URLSearchParams(call.search).get('page') ?? '1');
    const next = `<${nextOrigin}/installation/repositories?per_page=100&page=${page + 1}>; rel="next"`;
    const last = `<${NEXT_HOST}/installation/repositories?per_page=100&page=${pages}>; rel="last"`;
    return json(
      { total_count: pages, repositories: [repositoryJson(page, `acme/repo-${page}`)] },
      200,
      page < pages ? { link: `${next}, ${last}` } : {},
    );
  };
}

test('a list of exactly 100 pages is read in full, each page asked for with the URL the Link named', async () => {
  const { client, calls } = clientFixture({ 'GET /installation/repositories': repositoryPages(100) });
  const repositories = await client.listInstallationRepositories(id(11));
  expect(repositories.map((repository) => repository.id)).toEqual(Array.from({ length: 100 }, (_, n) => n + 1));
  expect(calls).toHaveLength(100);
  expect(calls.slice(0, 3).map(line)).toEqual([
    'GET /installation/repositories?per_page=100',
    'GET /installation/repositories?per_page=100&page=2',
    'GET /installation/repositories?per_page=100&page=3',
  ]);
});

test('every page carries the installation token', async () => {
  const { client, calls } = clientFixture({ 'GET /installation/repositories': repositoryPages(3) });
  await client.listInstallationRepositories(id(11));
  expect(calls.map((call) => call.headers.get('authorization'))).toEqual(Array(3).fill('Bearer ghs_made-up-11-1'));
});

test('a 101st page raises pagination_limit with the route and returns nothing, never a truncated list', async () => {
  const { client, calls } = clientFixture({ 'GET /installation/repositories': repositoryPages(101) });
  const failure = await client.listInstallationRepositories(id(11)).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubResponseError);
  expect(failure).toMatchObject({ route: 'GET /installation/repositories', paths: ['pagination_limit'] });
  expect(calls).toHaveLength(100);
});

test('the same limit holds for the list of installations', async () => {
  const link = (page: number): string => `<${NEXT_HOST}/app/installations?per_page=100&page=${page + 1}>; rel="next"`;
  const { client } = clientFixture({
    'GET /app/installations': (call) =>
      json([], 200, { link: link(Number(new URLSearchParams(call.search).get('page') ?? '1')) }),
  });
  await expect(client.listInstallations()).rejects.toMatchObject({
    route: 'GET /app/installations',
    paths: ['pagination_limit'],
  });
});

test.each([
  ['another host', 'https://evil.example'],
  ['a host that starts like api.github.com', 'https://api.github.com.evil.example'],
  // eslint-disable-next-line sonarjs/no-clear-text-protocols -- test: a Link that downgrades to plain http must be refused
  ['plain http', 'http://api.github.com'],
  ['a host with the real one as user info', 'https://api.github.com@evil.example'],
])('a Link to %s is refused and nothing is sent there', async (_name, origin) => {
  const { client, calls } = clientFixture({ 'GET /installation/repositories': repositoryPages(2, origin) });
  const failure = await client.listInstallationRepositories(id(11)).catch((error: unknown) => error);
  expect(failure).toMatchObject({ route: 'GET /installation/repositories', paths: ['link'] });
  expect(calls).toHaveLength(1);
});

test('the next page is found among the other relations of the Link header, in any order', async () => {
  const { client, calls } = clientFixture({
    'GET /installation/repositories': (call) =>
      call.search.includes('page=2')
        ? json({ repositories: [repositoryJson(2)] })
        : json({ repositories: [repositoryJson(1)] }, 200, {
            link: `<${NEXT_HOST}/x?page=9>; rel="last", <${NEXT_HOST}/installation/repositories?per_page=100&page=2>; rel="next", <${NEXT_HOST}/x?page=1>; rel="first"`,
          }),
  });
  expect((await client.listInstallationRepositories(id(11))).map((repository) => repository.id)).toEqual([1, 2]);
  expect(calls).toHaveLength(2);
});

test('a Link with no next relation ends the list', async () => {
  const { client, calls } = clientFixture({
    'GET /installation/repositories': () =>
      json({ repositories: [repositoryJson(1)] }, 200, { link: `<${NEXT_HOST}/x?page=1>; rel="prev"` }),
  });
  expect(await client.listInstallationRepositories(id(11))).toHaveLength(1);
  expect(calls).toHaveLength(1);
});

test('a bad entry on a later page fails the whole list with its path, and no partial list is returned', async () => {
  const { client } = clientFixture({
    'GET /installation/repositories': (call) =>
      call.search.includes('page=2')
        ? json({ repositories: [{ id: 2, full_name: '' }] })
        : json({ repositories: [repositoryJson(1)] }, 200, {
            link: `<${NEXT_HOST}/installation/repositories?per_page=100&page=2>; rel="next"`,
          }),
  });
  await expect(client.listInstallationRepositories(id(11))).rejects.toMatchObject({
    route: 'GET /installation/repositories',
    paths: ['repositories.0.full_name'],
  });
});
