// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { AppError } from './errors.ts';
import { type TenantResolver, type TenantTarget, tenantAccess } from './tenant-access.ts';
import { guardWorld } from './tenant-guard-fixture/test-support.ts';
import { byInstallationParam, byRepositoryParam } from './tenant-resolvers.ts';

// The two resolvers of E11-S05 as they are given requests: what each names for a path, and what it refuses. A recording
// wrapper hands the result of the resolver to the test and answers null, so the guard answers the 404 and nothing else runs.

type Seen = TenantTarget | null | Error;

/** The app with the three paths a resolver can be keyed by; `seen` holds what the resolver said for each request. */
async function world() {
  const guard = await guardWorld();
  const seen: Seen[] = [];
  const recording =
    (resolver: TenantResolver): TenantResolver =>
    async (request) => {
      try {
        seen.push(await resolver(request));
      } catch (error) {
        seen.push(error instanceof Error ? error : new Error('not an error'));
      }
      return null;
    };
  const route = (url: string, resolver: TenantResolver) =>
    guard.app.get(url, { config: { access: tenantAccess({ mode: 'read', resolve: recording(resolver) }) } }, () => 'x');
  route('/r/installations/:installationId', byInstallationParam(guard.db));
  route('/r/repositories/:repositoryId', byRepositoryParam(guard.db));
  route('/r/installations/:installationId/repositories/:repositoryId', byRepositoryParam(guard.db));
  const resolved = async (url: string): Promise<Seen | undefined> => {
    seen.length = 0;
    await guard.ask('GET', url, 'outsider');
    return seen[0];
  };
  return { ...guard, resolved };
}

type World = Awaited<ReturnType<typeof world>>;

const installationTarget = (tenant: World['tenants']['t1']): TenantTarget => ({
  installationId: tenant,
  repositoryId: null,
  requirement: 'org_admin',
});

test('an installation path names the installation and asks for an org admin', async () => {
  const w = await world();
  expect(await w.resolved(`/r/installations/${w.tenants.t1}`)).toEqual(installationTarget(w.tenants.t1));
});

test.each([
  ['an id that names nothing', () => '987654'],
  ['a tenant the admission policy rejected', (w: World) => String(w.tenants.rejected)],
])('an installation path with %s resolves to null', async (_name, idOf) => {
  const w = await world();
  expect(await w.resolved(`/r/installations/${idOf(w)}`)).toBeNull();
});

test("a suspended or deleted installation still resolves: its state is the guard's to judge, with its role", async () => {
  const w = await world();
  expect(await w.resolved(`/r/installations/${w.tenants.suspendedUser}`)).toEqual(
    installationTarget(w.tenants.suspendedUser),
  );
  expect(await w.resolved(`/r/installations/${w.tenants.deletedUser}`)).toEqual(
    installationTarget(w.tenants.deletedUser),
  );
});

test.each([
  ['a repository path alone', (w: World) => `/r/repositories/${w.repositories.t1r1}`],
  [
    'a path with the installation of the repository before it',
    (w: World) => `/r/installations/${w.tenants.t1}/repositories/${w.repositories.t1r1}`,
  ],
])('%s names the repository and its installation and asks for a repository admin', async (_name, pathOf) => {
  const w = await world();
  expect(await w.resolved(pathOf(w))).toEqual({
    installationId: w.tenants.t1,
    repositoryId: w.repositories.t1r1,
    requirement: 'repo_admin',
  });
});

test.each([
  ['an unknown repository', (w: World) => `/r/repositories/${w.repositories.t1r1 + 100_000}`],
  ['a removed repository', (w: World) => `/r/repositories/${w.repositories.t1removed}`],
  ['a repository of a rejected tenant', (w: World) => `/r/repositories/${w.repositories.rejectedR1}`],
  [
    'a repository of another installation than the one in the path',
    (w: World) => `/r/installations/${w.tenants.t2}/repositories/${w.repositories.t1r1}`,
  ],
  [
    'a removed repository under its own installation',
    (w: World) => `/r/installations/${w.tenants.t1}/repositories/${w.repositories.t1removed}`,
  ],
  ['an unknown installation in the path', (w: World) => `/r/installations/987654/repositories/${w.repositories.t1r1}`],
  [
    'a rejected installation in the path',
    (w: World) => `/r/installations/${w.tenants.rejected}/repositories/${w.repositories.rejectedR1}`,
  ],
])('%s resolves to null', async (_name, pathOf) => {
  const w = await world();
  expect(await w.resolved(pathOf(w))).toBeNull();
});

test.each([
  ['a repository id that is a word', () => '/r/repositories/abc'],
  ['a repository id of zero', () => '/r/repositories/0'],
  ['a repository id with a leading zero', () => '/r/repositories/01'],
  ['an installation id that is a word beside a good repository', () => '/r/installations/abc/repositories/1'],
  ['a repository id that is a word beside a good installation', () => '/r/installations/1/repositories/abc'],
  ['an installation id that no number holds exactly', () => '/r/installations/9007199254740993'],
])('%s is a 400 and reads nothing', async (_name, pathOf) => {
  const w = await world();
  // What a request that only needs the session costs: the lookup of the session and nothing else.
  const session = await w.statementsOf('/probe/protected', 'outsider');
  const before = w.queries.length;
  const answer = await w.resolved(pathOf());
  expect(answer).toBeInstanceOf(AppError);
  expect(answer).toMatchObject({ status: 400, code: 'bad_request' });
  expect(w.queries.length - before).toBe(session);
});
