// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { createLogger } from '../adapters/http/logger.ts';
import { captureLogs } from '../test-support.ts';
import { createAdminLedger } from './admin-ledger.ts';
import { githubOfTwoTenants, scopeDocuments } from './discovery-fixture/test-support.ts';
import { id } from './github-contract/test-support.ts';
import { listAdministrableInstallations } from './installation-queries.ts';
import { findRoles } from './installation-roles.ts';
import { createOrgAdminLookup } from './org-admin.ts';
import { InstallationSuspendedError } from './ports/github-errors.ts';
import { ProbeBudget } from './probe-budget.ts';
import { createRepoAdminLookup } from './repo-admin.ts';
import { createRepoAdminDiscovery } from './repo-admin-discovery.ts';
import { RoleCache } from './role-cache.ts';
import { VIEWER, VIEWER_ID } from './role-fixture/test-support.ts';
import { createViewerLookupBudget, type ViewerLookupBudget } from './role-lookup-budget.ts';
import { createRoleLookups } from './role-lookups.ts';
import { worldOfTwoTenants } from './store-fixture/test-support.ts';
import type { TenantAuthorizationDeps } from './tenant-authorization.ts';
import { FakeClock } from './test-support.ts';

// The roles a person holds across the installations of the instance (E14-S01), with the lookups over a real database and an
// in-memory GitHub. The guard's budget of 30 uncached lookups a minute is not in the picture here, and the budget of the
// list's lookups is out of it unless a test gives one, so that what is tested is the budget of the search itself.

/** A budget that lets every lookup through. */
const UNLIMITED: ViewerLookupBudget = { spend: () => undefined };

const NOW = '2026-11-02T10:00:00.000Z';

async function setup(listBudget: ViewerLookupBudget = UNLIMITED) {
  const world = await worldOfTwoTenants();
  const fake = githubOfTwoTenants();
  const clock = new FakeClock(NOW);
  const log = createLogger({ logLevel: 'info' }, captureLogs().destination);
  const cache = new RoleCache({ clock });
  const lookupsOver = (budget: ViewerLookupBudget) =>
    createRoleLookups({
      cache,
      budget,
      orgAdmin: createOrgAdminLookup({ github: fake, log }),
      repoAdmin: createRepoAdminLookup({ github: fake, log }),
    });
  const lookups = lookupsOver(UNLIMITED);
  const listed = lookupsOver(listBudget).read;
  const deps: TenantAuthorizationDeps = {
    lookups: { ...lookups, list: listed },
    discover: createRepoAdminDiscovery({ db: world.db, lookup: lookups.read.repoAdmin }),
    discoverForList: createRepoAdminDiscovery({ db: world.db, lookup: listed.repoAdmin }),
    ledger: createAdminLedger({ db: world.db, clock }),
  };
  const find = async (budget = new ProbeBudget(100)) =>
    findRoles(deps, VIEWER, await listAdministrableInstallations(world.db), budget);
  const permissionLookups = (githubInstallationId: number) =>
    fake.calls.filter(
      (call) => call.method === 'getRepositoryPermission' && call.installationId === id(githubInstallationId),
    ).length;
  /** Gives tenant `n` the repositories `org-<n>/repo-3` to `repo-<count>` too, every one with a document of its own. */
  const crowd = async (n: 1 | 2, count: number) => {
    const tenant = n === 1 ? world.a : world.b;
    const indexes = Array.from({ length: count - 2 }, (_unused, index) => index + 3);
    await world.store.upsertRepositories(
      tenant.installation.id,
      indexes.map((index) => ({ githubRepoId: id(n * 10_000 + index), fullName: `org-${n}/repo-${index}` })),
    );
    await scopeDocuments(
      world.db,
      tenant.installation.id,
      Array.from({ length: count }, (_unused, index) => `org-${n}/repo-${index + 1}`),
    );
  };
  const membershipLookups = () => fake.calls.filter((call) => call.method === 'getOrgMembership').length;
  return { ...world, fake, find, permissionLookups, membershipLookups, crowd, clock };
}

test('a person GitHub knows nowhere holds no role, and the search says it was not cut short', async () => {
  const { find } = await setup();
  expect(await find()).toEqual({ held: [], truncated: false });
});

test('an org admin holds the role in their organisation, which costs no search of its repositories', async () => {
  const { find, fake, a, permissionLookups } = await setup();
  fake.addMembership(id(100), 'org-1', 'alice', { state: 'active', role: 'admin', userId: VIEWER_ID });
  const found = await find();
  expect(found.held.map(({ installation, role }) => [installation.id, role])).toEqual([
    [a.installation.id, 'org_admin'],
  ]);
  expect(permissionLookups(100)).toBe(0);
});

test('an admin of a repository with a repo-scoped document holds the role repo_admin in its installation, and only there', async () => {
  const { find, fake, db, a, b } = await setup();
  await scopeDocuments(db, a.installation.id, ['org-1/repo-2']);
  await scopeDocuments(db, b.installation.id, ['org-2/repo-1']);
  fake.addRepositoryPermission(id(100), 'org-1/repo-2', 'alice', { permission: 'admin', userId: VIEWER_ID });
  const found = await find();
  expect(found.held.map(({ installation, role }) => [installation.id, role])).toEqual([
    [a.installation.id, 'repo_admin'],
  ]);
  expect(found.truncated).toBe(false);
});

test('the search spends at most the 100 lookups of its budget over all installations, asks the first installation first, and says it was cut short', async () => {
  const { find, crowd, permissionLookups, fake } = await setup();
  await crowd(1, 80);
  await crowd(2, 80);
  const found = await find();
  expect(found).toEqual({ held: [], truncated: true });
  expect([permissionLookups(100), permissionLookups(200)]).toEqual([80, 20]);
  expect(
    fake.calls.every((call) => call.method === 'getOrgMembership' || call.method === 'getRepositoryPermission'),
  ).toBe(true);
});

test('an admin the budget still reaches is found and the search is not cut short, as it stopped at the hit', async () => {
  const { find, crowd, fake, permissionLookups, b } = await setup();
  await crowd(1, 80);
  await crowd(2, 80);
  fake.addRepositoryPermission(id(200), 'org-2/repo-1', 'alice', { permission: 'admin', userId: VIEWER_ID });
  const found = await find();
  expect(found.held.map(({ installation, role }) => [installation.id, role])).toEqual([
    [b.installation.id, 'repo_admin'],
  ]);
  expect(found.truncated).toBe(false);
  expect(permissionLookups(200)).toBeLessThanOrEqual(20);
});

test('a budget already spent asks about no repository at all and is a cut-short search', async () => {
  const { find, crowd, permissionLookups } = await setup();
  await crowd(1, 5);
  expect(await find(new ProbeBudget(0))).toEqual({ held: [], truncated: true });
  expect(permissionLookups(100)).toBe(0);
});

test('an installation GitHub stopped serving under the lookup is left out, and the others are still searched', async () => {
  const { find, fake, db, a, b } = await setup();
  await scopeDocuments(db, b.installation.id, ['org-2/repo-1']);
  fake.addRepositoryPermission(id(200), 'org-2/repo-1', 'alice', { permission: 'admin', userId: VIEWER_ID });
  fake.failNext('getOrgMembership', new InstallationSuspendedError(id(100)));
  const found = await find();
  expect(found.held.map(({ installation, role }) => [installation.id, role])).toEqual([
    [b.installation.id, 'repo_admin'],
  ]);
  expect(found.held.map(({ installation }) => installation.id)).not.toContain(a.installation.id);
});

test('a suspended installation is not searched for repository admins', async () => {
  const { find, fake, db, a, permissionLookups } = await setup();
  await scopeDocuments(db, a.installation.id, ['org-1/repo-1']);
  fake.addRepositoryPermission(id(100), 'org-1/repo-1', 'alice', { permission: 'admin', userId: VIEWER_ID });
  await db
    .updateTable('installations')
    .set({ suspended_at: new Date('2026-11-01T00:00:00.000Z') })
    .where('id', '=', a.installation.id)
    .execute();
  expect(await find()).toEqual({ held: [], truncated: false });
  expect(permissionLookups(100)).toBe(0);
});

test('a person over the lookups the list may make is given what was found, cut short, and no installation past that is asked about', async () => {
  const { find, fake, a, membershipLookups } = await setup(createViewerLookupBudget(new FakeClock(NOW), 1));
  fake.addMembership(id(100), 'org-1', 'alice', { state: 'active', role: 'admin', userId: VIEWER_ID });
  fake.addMembership(id(200), 'org-2', 'alice', { state: 'active', role: 'admin', userId: VIEWER_ID });
  const found = await find();
  expect(found.held.map(({ installation, role }) => [installation.id, role])).toEqual([
    [a.installation.id, 'org_admin'],
  ]);
  expect(found.truncated).toBe(true);
  expect(membershipLookups()).toBe(1);
});

test('the lookups the list may make also end the search of repository admins, which is cut short and not a failure', async () => {
  const { find, crowd, permissionLookups, membershipLookups } = await setup(
    createViewerLookupBudget(new FakeClock(NOW), 2),
  );
  await crowd(1, 5);
  expect(await find()).toEqual({ held: [], truncated: true });
  expect([membershipLookups(), permissionLookups(100)]).toEqual([2, 0]);
});

test('a search no budget cuts short says so with truncated false', async () => {
  const { find, membershipLookups } = await setup(createViewerLookupBudget(new FakeClock(NOW), 2));
  expect(await find()).toEqual({ held: [], truncated: false });
  expect(membershipLookups()).toBe(2);
});
