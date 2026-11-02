// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { createLogger } from '../adapters/http/logger.ts';
import { captureLogs } from '../test-support.ts';
import { githubOfTwoTenants, namesOf, scopeDocuments } from './discovery-fixture/test-support.ts';
import { id } from './github-contract/test-support.ts';
import { createOrgAdminLookup } from './org-admin.ts';
import { ProbeBudget } from './probe-budget.ts';
import { createRepoAdminLookup } from './repo-admin.ts';
import { createRepoAdminDiscovery } from './repo-admin-discovery.ts';
import { RoleCache } from './role-cache.ts';
import { VIEWER, VIEWER_ID } from './role-fixture/test-support.ts';
import { createViewerLookupBudget } from './role-lookup-budget.ts';
import { createRoleLookups } from './role-lookups.ts';
import { worldOfTwoTenants } from './store-fixture/test-support.ts';
import { FakeClock } from './test-support.ts';

// The repository admin discovery of E11-S03 behind the role cache (E11-S04): a hit costs GitHub nothing and the request's
// probe budget nothing, which is what lets a listing page be reloaded without spending 100 probes each time.

async function setup() {
  const world = await worldOfTwoTenants();
  const fake = githubOfTwoTenants();
  const clock = new FakeClock('2026-11-02T10:00:00.000Z');
  const log = createLogger({ logLevel: 'info' }, captureLogs().destination);
  const lookups = createRoleLookups({
    cache: new RoleCache({ clock }),
    budget: createViewerLookupBudget(clock),
    orgAdmin: createOrgAdminLookup({ github: fake, log }),
    repoAdmin: createRepoAdminLookup({ github: fake, log }),
  });
  return {
    ...world,
    fake,
    clock,
    lookups,
    discover: createRepoAdminDiscovery({ db: world.db, lookup: lookups.read.repoAdmin }),
  };
}

const permissionCalls = (calls: readonly { method: string }[]): number =>
  calls.filter((call) => call.method === 'getRepositoryPermission').length;

test('a second discovery for the same person is answered by the cache: no GitHub call and no probe spent', async () => {
  const { db, a, fake, discover } = await setup();
  await scopeDocuments(db, a.installation.id, namesOf(1, [1, 2]));
  fake.addRepositoryPermission(id(100), 'org-1/repo-2', 'alice', { permission: 'admin', userId: id(VIEWER_ID) });
  const first = new ProbeBudget(100);
  expect(await discover(VIEWER, a.installation.id, first)).toEqual({ role: 'repo_admin', truncated: false });
  const asked = permissionCalls(fake.calls);
  expect(asked).toBeGreaterThan(0);
  expect(first.remaining).toBe(100 - asked);
  const second = new ProbeBudget(100);
  expect(await discover(VIEWER, a.installation.id, second)).toEqual({ role: 'repo_admin', truncated: false });
  expect(permissionCalls(fake.calls)).toBe(asked);
  expect(second.remaining).toBe(100);
});

test('a discovery that found no role is cached as well, and a second run with a budget of 0 does not need one', async () => {
  const { db, a, fake, discover } = await setup();
  await scopeDocuments(db, a.installation.id, namesOf(1, [1, 2]));
  expect(await discover(VIEWER, a.installation.id, new ProbeBudget(100))).toEqual({ role: 'none', truncated: false });
  expect(permissionCalls(fake.calls)).toBe(2);
  const again = new ProbeBudget(2);
  expect(await discover(VIEWER, a.installation.id, again)).toEqual({ role: 'none', truncated: false });
  expect([permissionCalls(fake.calls), again.remaining]).toEqual([2, 2]);
});

test('the answers are kept per tenant: tenant 2 is asked of GitHub though tenant 1 was just answered', async () => {
  const { db, a, b, fake, discover } = await setup();
  await scopeDocuments(db, a.installation.id, namesOf(1, [1]));
  await scopeDocuments(db, b.installation.id, namesOf(2, [1]));
  await discover(VIEWER, a.installation.id, new ProbeBudget(100));
  await discover(VIEWER, b.installation.id, new ProbeBudget(100));
  expect(fake.calls.map((call) => call.installationId)).toEqual([100, 200]);
});

test('after the 60 s the discovery asks GitHub again and sees a demotion', async () => {
  const { db, a, clock, fake, discover } = await setup();
  await scopeDocuments(db, a.installation.id, namesOf(1, [1]));
  fake.addRepositoryPermission(id(100), 'org-1/repo-1', 'alice', { permission: 'admin', userId: id(VIEWER_ID) });
  expect(await discover(VIEWER, a.installation.id, new ProbeBudget(100))).toEqual({
    role: 'repo_admin',
    truncated: false,
  });
  fake.addRepositoryPermission(id(100), 'org-1/repo-1', 'alice', { permission: 'write', userId: id(VIEWER_ID) });
  clock.advance(59_999);
  expect(await discover(VIEWER, a.installation.id, new ProbeBudget(100))).toEqual({
    role: 'repo_admin',
    truncated: false,
  });
  clock.advance(1);
  expect(await discover(VIEWER, a.installation.id, new ProbeBudget(100))).toEqual({ role: 'none', truncated: false });
});
