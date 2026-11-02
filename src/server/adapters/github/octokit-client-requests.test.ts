// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import type { GitHubClient } from '../../services/ports/github.ts';
import {
  type ClientFixture,
  clientFixture,
  installationJson,
  json,
  line,
  MADE_UP_JWT,
  membershipJson,
  permissionJson,
  type Routes,
  repositoryJson,
} from './client-fixture/test-support.ts';
import { readPackageVersion } from './package-version.ts';
import { appBody } from './test-support.ts';

const id = parseGithubId;

const routes: Routes = {
  'GET /app': () => json(appBody()),
  'GET /app/installations/:id': () => json(installationJson(11)),
  'GET /app/installations': () => json([installationJson(11)]),
  'GET /installation/repositories': () => json({ total_count: 1, repositories: [repositoryJson(101)] }),
  'GET /repositories/:id': () => json(repositoryJson(101)),
  'GET /orgs/:org/memberships/:username': () => json(membershipJson(501)),
  'GET /repos/:owner/:repo/collaborators/:username/permission': () => json(permissionJson(501)),
};

const JWT = `Bearer ${MADE_UP_JWT}`;
const TOKEN = 'Bearer ghs_made-up-11-1';

type Row = [name: string, run: (client: GitHubClient) => Promise<unknown>, sent: string, credential: string];

const ROWS: Row[] = [
  ['getApp', (client) => client.getApp(), 'GET /app', JWT],
  ['getInstallation', (client) => client.getInstallation(id(11)), 'GET /app/installations/11', JWT],
  ['listInstallations', (client) => client.listInstallations(), 'GET /app/installations?per_page=100', JWT],
  [
    'listInstallationRepositories',
    (client) => client.listInstallationRepositories(id(11)),
    'GET /installation/repositories?per_page=100',
    TOKEN,
  ],
  ['getRepositoryById', (client) => client.getRepositoryById(id(11), id(101)), 'GET /repositories/101', TOKEN],
  [
    'getOrgMembership',
    (client) => client.getOrgMembership(id(11), 'my-org_1', 'Alice-9'),
    'GET /orgs/my-org_1/memberships/Alice-9',
    TOKEN,
  ],
  [
    'getRepositoryPermission',
    (client) => client.getRepositoryPermission(id(11), 'my-org_1', '.my-repo.v2', 'Alice-9'),
    'GET /repos/my-org_1/.my-repo.v2/collaborators/Alice-9/permission',
    TOKEN,
  ],
];

test.each(ROWS)(
  '%s sends one %s with the right credential: the App JWT or the installation token',
  async (_name, run, sent, credential) => {
    const { client, calls } = clientFixture(routes);
    await run(client);
    expect(calls.map(line)).toEqual([sent]);
    expect(calls[0]?.headers.get('authorization')).toBe(credential);
  },
);

test.each(ROWS)('%s sends User-Agent cla-gate/<package version> and the pinned API version', async (_name, run) => {
  const { client, calls } = clientFixture(routes);
  await run(client);
  const version = readPackageVersion(path.resolve(import.meta.dirname, '../../../../package.json'));
  const headers = calls[0]?.headers;
  expect([headers?.get('user-agent'), headers?.get('x-github-api-version'), headers?.get('accept')]).toEqual([
    `cla-gate/${version}`,
    '2022-11-28',
    'application/vnd.github+json',
  ]);
});

test.each([
  ['an org with a path in it', '../orgs/other', 'alice'],
  ['a login with a slash', 'acme', 'a/b'],
  ['a login that climbs out of the route', 'acme', '..'],
  ['a login with a query', 'acme', 'alice?x=1'],
  ['an empty login', 'acme', ''],
  ['a login with a space', 'acme', 'al ice'],
  ['an org with a percent escape', '%2e%2e', 'alice'],
  ['a login over 100 characters', 'acme', 'a'.repeat(101)],
])('getOrgMembership resolves null for %s and sends nothing', async (_name, org, login) => {
  const { client, calls } = clientFixture(routes);
  expect(await client.getOrgMembership(id(11), org, login)).toBeNull();
  expect(calls).toEqual([]);
});

test.each([
  ['an owner with a path in it', '../orgs/other', 'api', 'alice'],
  ['an owner with a percent escape', '%2e%2e', 'api', 'alice'],
  ['a repository name that is a dot', 'acme', '.', 'alice'],
  ['a repository name that climbs out of the route', 'acme', '..', 'alice'],
  ['a repository name with a slash', 'acme', 'api/collaborators', 'alice'],
  ['a repository name with a query', 'acme', 'api?x=1', 'alice'],
  ['an empty repository name', 'acme', '', 'alice'],
  ['a repository name with a space', 'acme', 'my api', 'alice'],
  ['a repository name over 100 characters', 'acme', 'r'.repeat(101), 'alice'],
  ['a login with a slash', 'acme', 'api', 'a/b'],
  ['a login that climbs out of the route', 'acme', 'api', '..'],
  ['an empty login', 'acme', 'api', ''],
  ['a login over 100 characters', 'acme', 'api', 'a'.repeat(101)],
])('getRepositoryPermission resolves null for %s and sends nothing', async (_name, owner, repo, login) => {
  const { client, calls } = clientFixture(routes);
  expect(await client.getRepositoryPermission(id(11), owner, repo, login)).toBeNull();
  expect(calls).toEqual([]);
});

test('getRepositoryPermission takes a repository name of exactly 100 characters, and a name that starts with a dot', async () => {
  const { client, calls } = clientFixture(routes);
  await client.getRepositoryPermission(id(11), 'acme', 'r'.repeat(100), 'alice');
  await client.getRepositoryPermission(id(11), 'acme', '.github', 'alice');
  expect(calls.map(line)).toEqual([
    `GET /repos/acme/${'r'.repeat(100)}/collaborators/alice/permission`,
    'GET /repos/acme/.github/collaborators/alice/permission',
  ]);
});

test('getRepositoryPermission keeps the permission and the person id, and drops role_name and the rest of the answer', async () => {
  const { client } = clientFixture(routes);
  expect(await client.getRepositoryPermission(id(11), 'acme', 'api', 'alice')).toStrictEqual({
    permission: 'admin',
    userId: 501,
  });
});

function assertMemberOf(fixture: ClientFixture): void {
  expect(fixture.calls.map(line)).toEqual(['GET /orgs/acme/memberships/alice']);
}

test('getOrgMembership keeps state, role and the member id, and drops the rest of the answer', async () => {
  const fixture = clientFixture(routes);
  const membership = await fixture.client.getOrgMembership(id(11), 'acme', 'alice');
  assertMemberOf(fixture);
  expect(membership).toStrictEqual({ state: 'active', role: 'member', userId: 501 });
});

test('the answers keep only the fields used: ids, login, type, full name, suspension time and permissions', async () => {
  const { client } = clientFixture(routes);
  expect(await client.getInstallation(id(11))).toStrictEqual({
    id: 11,
    account: { id: 5011, login: 'acme', type: 'Organization' },
    suspendedAt: null,
    permissions: { checks: 'write', metadata: 'read' },
  });
  expect(await client.getRepositoryById(id(11), id(101))).toStrictEqual({ id: 101, fullName: 'acme/api' });
  expect(await client.getApp()).toStrictEqual({
    id: 4242,
    slug: 'cla-gate-test',
    owner: { id: 9001, type: 'Organization' },
    permissions: { checks: 'write', metadata: 'read', pull_requests: 'read' },
  });
});

test('an installation on a personal account (type User) is read like one on an organisation', async () => {
  const { client } = clientFixture({
    'GET /app/installations/:id': () =>
      json(
        installationJson(12, {
          account: { id: 77, login: 'alice', type: 'User' },
          suspended_at: '2026-11-01T09:30:00Z',
        }),
      ),
  });
  expect(await client.getInstallation(id(12))).toStrictEqual({
    id: 12,
    account: { id: 77, login: 'alice', type: 'User' },
    suspendedAt: new Date('2026-11-01T09:30:00Z'),
    permissions: { checks: 'write', metadata: 'read' },
  });
});
