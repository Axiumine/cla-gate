// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { Secret } from '../../config/secret.ts';
import type { GitHubClient } from '../../services/ports/github.ts';
import {
  GitHubAuthError,
  InstallationGoneError,
  InstallationNotAdmittedError,
} from '../../services/ports/github-errors.ts';
import {
  clientFixture,
  installationJson,
  json,
  line,
  membershipJson,
  type RouteCall,
  repositoryJson,
} from './client-fixture/test-support.ts';

const id = parseGithubId;

/** Refuses the first token (`ghs_made-up-11-1`) and accepts every later one. */
const stale = (accepted: () => Response) => (call: RouteCall) =>
  call.headers.get('authorization') === 'Bearer ghs_made-up-11-1'
    ? json({ message: 'Bad credentials' }, 401)
    : accepted();

const refuseAll: (call: RouteCall) => Response = () => json({ message: 'Bad credentials' }, 401);

interface Case {
  readonly run: (client: GitHubClient) => Promise<unknown>;
  /** What the adapter sends. */
  readonly request: string;
  /** The mocked route that answers it. */
  readonly route: string;
  readonly ok: () => Response;
}

const CASES: [name: string, spec: Case][] = [
  [
    'listInstallationRepositories',
    {
      run: (client) => client.listInstallationRepositories(id(11)),
      request: 'GET /installation/repositories?per_page=100',
      route: 'GET /installation/repositories',
      ok: () => json({ repositories: [repositoryJson(101)] }),
    },
  ],
  [
    'getRepositoryById',
    {
      run: (client) => client.getRepositoryById(id(11), id(101)),
      request: 'GET /repositories/101',
      route: 'GET /repositories/:id',
      ok: () => json(repositoryJson(101)),
    },
  ],
  [
    'getOrgMembership',
    {
      run: (client) => client.getOrgMembership(id(11), 'acme', 'alice'),
      request: 'GET /orgs/acme/memberships/alice',
      route: 'GET /orgs/:org/memberships/:username',
      ok: () => json(membershipJson(501)),
    },
  ],
];

test.each(CASES)(
  '%s: a 401 drops the cached token and repeats the request once with a new one',
  async (_name, spec) => {
    const { client, calls, invalidated } = clientFixture({ [spec.route]: stale(spec.ok) });
    expect(await spec.run(client)).not.toBeNull();
    expect(calls.map(line)).toEqual([spec.request, spec.request]);
    expect(calls.map((call) => call.headers.get('authorization'))).toEqual([
      'Bearer ghs_made-up-11-1',
      'Bearer ghs_made-up-11-2',
    ]);
    expect(invalidated).toEqual([11]);
  },
);

test.each(CASES)(
  '%s: a second 401 is GitHubAuthError, after exactly two requests and one drop',
  async (_name, spec) => {
    const { client, calls, invalidated } = clientFixture({ [spec.route]: refuseAll });
    await expect(spec.run(client)).rejects.toBeInstanceOf(GitHubAuthError);
    expect(calls).toHaveLength(2);
    expect(invalidated).toEqual([11]);
  },
);

test('a token that cannot be had stops the call before any request: gone, or not served', async () => {
  const gone = clientFixture(
    { 'GET /repositories/:id': () => json(repositoryJson(101)) },
    { get: () => Promise.reject(new InstallationGoneError(id(11))) },
  );
  await expect(gone.client.getRepositoryById(id(11), id(101))).rejects.toEqual(new InstallationGoneError(id(11)));
  const closed = clientFixture(
    { 'GET /installation/repositories': () => json({ repositories: [] }) },
    { get: () => Promise.reject(new InstallationNotAdmittedError('rejected')) },
  );
  await expect(closed.client.listInstallationRepositories(id(11))).rejects.toEqual(
    new InstallationNotAdmittedError('rejected'),
  );
  expect([gone.calls, closed.calls]).toEqual([[], []]);
});

test('a new token that cannot be had after a 401 ends the call with that error, without a second request', async () => {
  const { client, calls } = clientFixture(
    { 'GET /repositories/:id': refuseAll },
    {
      get: (_installation, issued) =>
        issued === 1
          ? Promise.resolve({ token: new Secret('ghs_made-up-11-1') })
          : Promise.reject(new InstallationGoneError(id(11))),
    },
  );
  await expect(client.getRepositoryById(id(11), id(101))).rejects.toBeInstanceOf(InstallationGoneError);
  expect(calls).toHaveLength(1);
});

test('a 401 for the App is GitHubAuthError at once: the signer owns the key fallback, no token is dropped', async () => {
  const { client, calls, invalidated } = clientFixture({ 'GET /app/installations/:id': refuseAll });
  await expect(client.getInstallation(id(11))).rejects.toBeInstanceOf(GitHubAuthError);
  expect([calls.length, invalidated]).toEqual([1, []]);
});

test('the installations of two tenants never share a token: each call uses the token of its own installation', async () => {
  const { client, calls } = clientFixture({
    'GET /repositories/:id': () => json(repositoryJson(101)),
  });
  await client.getRepositoryById(id(11), id(101));
  await client.getRepositoryById(id(12), id(101));
  expect(calls.map((call) => call.headers.get('authorization'))).toEqual([
    'Bearer ghs_made-up-11-1',
    'Bearer ghs_made-up-12-1',
  ]);
});

test('no log line holds a token or the JWT, whatever the adapter went through', async () => {
  const { client, logs } = clientFixture({
    'GET /repositories/:id': stale(() => json(repositoryJson(101))),
    'GET /app/installations': () => Response.error(),
  });
  await client.getRepositoryById(id(11), id(101));
  await client.listInstallations().catch(() => undefined);
  expect(logs.text()).not.toMatch(/ghs_|made-up/);
});

test('an installation the App can see is read with the App JWT and no token is requested for it', async () => {
  const { client, calls, invalidated } = clientFixture({
    'GET /app/installations/:id': () => json(installationJson(11)),
  });
  await client.getInstallation(id(11));
  expect(calls[0]?.headers.get('authorization')).toBe('Bearer made-up-jwt');
  expect(invalidated).toEqual([]);
});
