// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import {
  GitHubAuthError,
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubRateLimitedError,
  GitHubResponseError,
  GitHubUnavailableError,
} from '../../services/ports/github-errors.ts';
import {
  clientFixture,
  installationJson,
  json,
  membershipJson,
  repositoryJson,
} from './client-fixture/test-support.ts';

const id = parseGithubId;

/** The error a promise rejected with. @throws Error when it rejected with something else. */
function errorOf(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  throw new Error('expected an Error');
}

/** Text that must never come back out of an error: it is in the body of every failure below. */
const LEAK = 'LEAKED-BODY-TEXT ghs_leaked_token';

interface Failure {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly message: string;
  readonly expected: abstract new (...args: never[]) => Error;
  /** Whether the error names the route: a 401 is the same fixed text for every route. */
  readonly names: boolean;
}

const refusal = (message: string): Failure => ({
  status: 403,
  headers: {},
  message,
  expected: GitHubForbiddenError,
  names: true,
});

const outage = (status: number, headers: Record<string, string> = {}, message = LEAK): Failure => ({
  status,
  headers,
  message,
  expected: GitHubUnavailableError,
  names: true,
});

const FAILURES: [name: string, failure: Failure][] = [
  ['401', { status: 401, headers: {}, message: LEAK, expected: GitHubAuthError, names: false }],
  ['404', { status: 404, headers: {}, message: LEAK, expected: GitHubNotFoundError, names: true }],
  ['a 403 that is a refusal', refusal(`Resource not accessible by integration ${LEAK}`)],
  ['500', outage(500)],
  ['501', outage(501)],
  ['410', outage(410)],
  ['422', outage(422)],
];

test.each(FAILURES)('%s leaves as the right error, sent once, with none of the body', async (_name, spec) => {
  const { client, calls, waits } = clientFixture({
    'GET /app/installations': () =>
      json({ message: spec.message, documentation_url: 'https://docs.github.com/x' }, spec.status, spec.headers),
  });
  const failure = errorOf(await client.listInstallations().catch((error: unknown) => error));
  expect(failure).toBeInstanceOf(spec.expected);
  expect(String(failure).includes('GET /app/installations')).toBe(spec.names);
  expect(JSON.stringify(failure) + String(failure) + String(failure.stack)).not.toContain('LEAKED');
  expect(failure.cause).toBeUndefined();
  expect([calls.length, waits]).toEqual([1, []]);
});

test('a connection that fails is an outage after the two repeats, with no cause kept', async () => {
  const { client, calls, waits } = clientFixture({ 'GET /app/installations': () => Response.error() });
  const failure = errorOf(await client.listInstallations().catch((error: unknown) => error));
  expect(failure).toBeInstanceOf(GitHubUnavailableError);
  expect(failure.message).toContain('GitHub could not be reached');
  expect(failure.cause).toBeUndefined();
  expect([calls.length, waits]).toEqual([3, [1000, 2000]]);
});

test('an answer that takes longer than the timeout is an outage too, after the two repeats', async () => {
  const slow = async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return json([]);
  };
  const { client, calls } = clientFixture({ 'GET /app/installations': slow }, { timeoutMs: 30 });
  const failure = await client.listInstallations().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubUnavailableError);
  expect(String(failure)).toContain('TimeoutError');
  expect(calls).toHaveLength(3);
});

test('getInstallation resolves null on 404 and fails on a 403 refusal', async () => {
  const missing = clientFixture({ 'GET /app/installations/:id': () => json({ message: 'Not Found' }, 404) });
  expect(await missing.client.getInstallation(id(11))).toBeNull();
  const refused = clientFixture({ 'GET /app/installations/:id': () => json({ message: 'no' }, 403) });
  await expect(refused.client.getInstallation(id(11))).rejects.toBeInstanceOf(GitHubForbiddenError);
});

test.each([
  ['404', 404, 'Not Found'],
  ['403', 403, 'Resource not accessible by integration'],
])('getRepositoryById resolves null on %s: the repository left the installation', async (_name, status, message) => {
  const { client } = clientFixture({ 'GET /repositories/:id': () => json({ message }, status) });
  expect(await client.getRepositoryById(id(11), id(101))).toBeNull();
});

test.each([
  ['the primary limit used up', { 'x-ratelimit-remaining': '0' }, 'forbidden'],
  ['retry-after', { 'retry-after': '60' }, 'forbidden'],
  ['a secondary limit', {}, 'You have exceeded a secondary rate limit'],
])(
  'getRepositoryById does not take a 403 for %s as a removal: it waits, then fails as a rate limit',
  async (_name, headers, message) => {
    const { client, calls } = clientFixture({ 'GET /repositories/:id': () => json({ message }, 403, headers) });
    await expect(client.getRepositoryById(id(11), id(101))).rejects.toBeInstanceOf(GitHubRateLimitedError);
    expect(calls).toHaveLength(3);
  },
);

test('getOrgMembership resolves null on 404 and fails on a 403 (Members: read missing)', async () => {
  const missing = clientFixture({ 'GET /orgs/:org/memberships/:username': () => json({ message: 'Not Found' }, 404) });
  expect(await missing.client.getOrgMembership(id(11), 'acme', 'alice')).toBeNull();
  const refused = clientFixture({ 'GET /orgs/:org/memberships/:username': () => json({ message: 'no' }, 403) });
  await expect(refused.client.getOrgMembership(id(11), 'acme', 'alice')).rejects.toBeInstanceOf(GitHubForbiddenError);
});

/** Fields no schema keeps; a failure must not echo them. */
const SECRET_FIELD = { token: 'ghs_must_not_be_echoed', note: LEAK };

interface Bad {
  readonly call: 'installation' | 'repository' | 'membership' | 'list';
  readonly body: object;
  readonly route: string;
  readonly paths: string[];
}

const INSTALLATION = 'GET /app/installations/{installation_id}';
const MEMBERSHIP = 'GET /orgs/{org}/memberships/{username}';

const installationWith = (body: object, paths: string[]): Bad => ({
  call: 'installation',
  body,
  route: INSTALLATION,
  paths,
});

const membershipWith = (overrides: Record<string, unknown>, paths: string[]): Bad => ({
  call: 'membership',
  body: membershipJson(501, { ...overrides, ...SECRET_FIELD }),
  route: MEMBERSHIP,
  paths,
});

const BAD: [name: string, bad: Bad][] = [
  [
    'an installation with no suspended_at',
    installationWith({ ...installationJson(11), suspended_at: undefined, ...SECRET_FIELD }, ['suspended_at']),
  ],
  [
    'an installation whose id is not a positive integer',
    installationWith(installationJson(11, { id: -3, ...SECRET_FIELD }), ['id']),
  ],
  [
    'an installation whose suspended_at is not a date',
    installationWith(installationJson(11, { suspended_at: 'yesterday', ...SECRET_FIELD }), ['suspended_at']),
  ],
  [
    'an installation list with a bad entry',
    {
      call: 'list',
      body: [installationJson(11), installationJson(12, { account: null, ...SECRET_FIELD })],
      route: 'GET /app/installations',
      paths: ['1.account'],
    },
  ],
  [
    'a repository with no name',
    {
      call: 'repository',
      body: { ...repositoryJson(101), full_name: undefined, ...SECRET_FIELD },
      route: 'GET /repositories/{repository_id}',
      paths: ['full_name'],
    },
  ],
  ['a membership with no user', membershipWith({ user: null }, ['user'])],
  ['a membership with a role we do not know', membershipWith({ role: 'owner' }, ['role'])],
  ['a membership with a state we do not know', membershipWith({ state: 'banned' }, ['state'])],
];

test.each(BAD)('%s is a GitHubResponseError with the route and the paths, never the body', async (_name, bad) => {
  const { client } = clientFixture({
    'GET /app/installations/:id': () => json(bad.body),
    'GET /app/installations': () => json(bad.body),
    'GET /repositories/:id': () => json(bad.body),
    'GET /orgs/:org/memberships/:username': () => json(bad.body),
  });
  const attempts = {
    installation: () => client.getInstallation(id(11)),
    list: () => client.listInstallations(),
    repository: () => client.getRepositoryById(id(11), id(101)),
    membership: () => client.getOrgMembership(id(11), 'acme', 'alice'),
  };
  const failure = await attempts[bad.call]().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubResponseError);
  expect(failure).toMatchObject({ route: bad.route, paths: bad.paths });
  expect(String(failure) + JSON.stringify(failure)).not.toMatch(/ghs_|LEAKED/);
});

test('a 200 that is not JSON is a GitHubResponseError that names no path and quotes nothing', async () => {
  const html = () => new Response(`<html>${LEAK}</html>`, { status: 200, headers: { 'content-type': 'text/html' } });
  const { client } = clientFixture({ 'GET /repositories/:id': html });
  const failure = await client.getRepositoryById(id(11), id(101)).catch((error: unknown) => error);
  expect(failure).toMatchObject({ route: 'GET /repositories/{repository_id}', paths: ['(body)'] });
  expect(String(failure)).not.toContain('LEAKED');
});
