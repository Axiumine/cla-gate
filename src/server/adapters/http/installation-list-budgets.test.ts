// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { INSTALLATIONS_PATH, installationListSchema } from '../../../shared/installations.ts';
import { scopeDocuments } from '../../services/discovery-fixture/test-support.ts';
import { id } from '../../services/github-contract/test-support.ts';
import { bodyOf, listRepositories, namesOfPage, storeRepositories } from './installation-list-fixture/test-support.ts';
import { type GuardWorld, guardWorld, PEOPLE } from './tenant-guard-fixture/test-support.ts';

// The probe budgets of the lists of E14-S01, as the routes spend them: the installation list asks GitHub about at most 100
// repositories across all installations and says it was cut short, and the repository list lets a repository admin in after at
// most 50 (the guard's own search for a role is 10).

/** `count` repository names `org-<n>/many-000` on, each of which gets a repo-scoped document in tenant `n`. */
async function crowdTenant(world: GuardWorld, n: 1 | 2, count: number): Promise<string[]> {
  const installationId = n === 1 ? world.tenants.t1 : world.tenants.t2;
  const names = Array.from({ length: count }, (_unused, index) => `org-${n}/many-${String(index).padStart(3, '0')}`);
  await storeRepositories(world, { n, installationId }, names);
  await scopeDocuments(world.db, installationId, names);
  return names;
}

/** How many times GitHub was asked for a permission on a repository. */
const permissionLookups = (world: GuardWorld): number =>
  world.fake.calls.filter((call) => call.method === 'getRepositoryPermission').length;

/** Makes `login-<person>` an admin of the repository `fullName` of the organisation of tenant `n`. */
function makeAdmin(world: GuardWorld, n: 1 | 2, fullName: string, person: number): void {
  world.fake.addRepositoryPermission(id(n * 100), fullName, `login-${person}`, {
    permission: 'admin',
    userId: id(person),
  });
}

test('the installation list spends at most 100 probes across installations, and says on every row that it was cut short', async () => {
  const world = await guardWorld();
  await crowdTenant(world, 2, 150);
  const response = await world.ask('GET', INSTALLATIONS_PATH, 'admin1');
  expect(bodyOf(response, installationListSchema).map((row) => [row.id, row.role, row.truncated])).toEqual([
    [world.tenants.t1, 'org_admin', true],
  ]);
  expect(permissionLookups(world)).toBe(100);
});

test('the probes of the list go to the installations in order, so an admin past the 100th repository is left out and the installation before is listed', async () => {
  const world = await guardWorld();
  const names = await crowdTenant(world, 2, 150);
  makeAdmin(world, 1, 'org-1/repo-2', PEOPLE.repoAdminOther);
  makeAdmin(world, 2, names[120] ?? '', PEOPLE.repoAdminOther);
  const response = await world.ask('GET', INSTALLATIONS_PATH, 'repoAdminOther');
  expect(bodyOf(response, installationListSchema).map((row) => [row.id, row.role, row.truncated])).toEqual([
    [world.tenants.t1, 'repo_admin', true],
  ]);
  expect(permissionLookups(world)).toBe(100);
});

test('an admin the budget reaches is listed, and a search that asked about every repository is not cut short', async () => {
  const world = await guardWorld();
  const names = await crowdTenant(world, 2, 60);
  makeAdmin(world, 2, names[59] ?? '', PEOPLE.repoAdminOther);
  const response = await world.ask('GET', INSTALLATIONS_PATH, 'repoAdminOther');
  expect(bodyOf(response, installationListSchema).map((row) => [row.id, row.role, row.truncated])).toEqual([
    [world.tenants.t1, 'repo_admin', false],
    [world.tenants.t2, 'repo_admin', false],
  ]);
});

test('a repository admin whose repository is the eleventh candidate is let into the repository list: the search for a role there may ask 50', async () => {
  const world = await guardWorld();
  const names = await crowdTenant(world, 1, 9);
  makeAdmin(world, 1, names[8] ?? '', PEOPLE.outsider);
  const response = await listRepositories(world, 'outsider', world.tenants.t1);
  expect([response.statusCode, namesOfPage(response)]).toEqual([200, [names[8]]]);
});
