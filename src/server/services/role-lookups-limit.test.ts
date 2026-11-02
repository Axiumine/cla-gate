// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { ProbeBudget } from './probe-budget.ts';
import { VIEWER, VIEWER_ID } from './role-fixture/test-support.ts';
import { RoleLookupThrottledError } from './role-lookup-budget.ts';
import { githubInstallationOf, repositoryRow, rolesWorld, tenantRow } from './role-lookups-fixture/test-support.ts';

// At most 30 uncached lookups a minute per person, whichever installations they are for (E11-S04): the protection of the
// GitHub budgets of tenants the person walks over.

/** A world of 31 installations, the viewer an admin of each. */
function manyTenants() {
  const world = rolesWorld(31);
  for (let n = 1; n <= 31; n += 1) {
    world.setOrgRole(n, 'admin');
  }
  return world;
}

const membershipCalls = (fake: { calls: readonly { method: string }[] }): number =>
  fake.calls.filter((call) => call.method === 'getOrgMembership').length;

test('31 distinct installations in a minute: 30 are asked of GitHub and the 31st is refused before any call', async () => {
  const { fake, lookups } = manyTenants();
  for (let n = 1; n <= 30; n += 1) {
    expect(await lookups.read.orgAdmin(tenantRow(n), VIEWER)).toBe(true);
  }
  const refused = await lookups.read.orgAdmin(tenantRow(31), VIEWER).catch((error: unknown) => error);
  expect(refused).toBeInstanceOf(RoleLookupThrottledError);
  expect(refused).toMatchObject({ retryAfterSeconds: 60 });
  expect(membershipCalls(fake)).toBe(30);
  expect(fake.calls.map((call) => call.installationId)).not.toContain(githubInstallationOf(31));
});

test('what the cache holds is still served to a person who is over the limit, at no cost', async () => {
  const { fake, lookups } = manyTenants();
  for (let n = 1; n <= 30; n += 1) {
    await lookups.read.orgAdmin(tenantRow(n), VIEWER);
  }
  await expect(lookups.read.orgAdmin(tenantRow(31), VIEWER)).rejects.toBeInstanceOf(RoleLookupThrottledError);
  expect(await lookups.read.orgAdmin(tenantRow(7), VIEWER)).toBe(true);
  expect(membershipCalls(fake)).toBe(30);
});

test('a write is an uncached lookup too: it counts, and it is refused when the 30 are used', async () => {
  const { lookups } = manyTenants();
  for (let n = 1; n <= 30; n += 1) {
    await lookups.write.orgAdmin(tenantRow(1), VIEWER);
  }
  await expect(lookups.write.orgAdmin(tenantRow(1), VIEWER)).rejects.toBeInstanceOf(RoleLookupThrottledError);
  await expect(lookups.read.orgAdmin(tenantRow(2), VIEWER)).rejects.toBeInstanceOf(RoleLookupThrottledError);
});

test('repository lookups count against the same 30, and the person is told when to come back', async () => {
  const { clock, lookups, setRepoPermission } = manyTenants();
  for (let index = 1; index <= 20; index += 1) {
    setRepoPermission(1, index, 'write');
    await lookups.read.repoAdmin(tenantRow(1), repositoryRow(1, index), VIEWER);
  }
  for (let n = 1; n <= 10; n += 1) {
    await lookups.read.orgAdmin(tenantRow(n), VIEWER);
  }
  clock.advance(15_000);
  const refused = await lookups.read
    .repoAdmin(tenantRow(1), repositoryRow(1, 21), VIEWER)
    .catch((error: unknown) => error);
  expect(refused).toMatchObject({ name: 'RoleLookupThrottledError', retryAfterSeconds: 45 });
});

test('the limit is a sliding minute: after it the person may ask again', async () => {
  const { clock, lookups } = manyTenants();
  for (let n = 1; n <= 30; n += 1) {
    await lookups.read.orgAdmin(tenantRow(n), VIEWER);
  }
  clock.advance(59_999);
  await expect(lookups.read.orgAdmin(tenantRow(31), VIEWER)).rejects.toBeInstanceOf(RoleLookupThrottledError);
  clock.advance(1);
  expect(await lookups.read.orgAdmin(tenantRow(31), VIEWER)).toBe(true);
});

test('another person is not held back by the first person walking over installations', async () => {
  const { fake, lookups } = manyTenants();
  const other = { githubId: parseGithubId(VIEWER_ID + 1), login: 'bob' };
  fake.addMembership(parseGithubId(githubInstallationOf(31)), 'org-31', 'bob', {
    state: 'active',
    role: 'admin',
    userId: other.githubId,
  });
  for (let n = 1; n <= 30; n += 1) {
    await lookups.read.orgAdmin(tenantRow(n), VIEWER);
  }
  await expect(lookups.read.orgAdmin(tenantRow(31), VIEWER)).rejects.toBeInstanceOf(RoleLookupThrottledError);
  expect(await lookups.read.orgAdmin(tenantRow(31), other)).toBe(true);
});

test('a refused lookup leaves the probe budget of the request alone', async () => {
  const { lookups, setRepoPermission } = manyTenants();
  for (let n = 1; n <= 30; n += 1) {
    await lookups.read.orgAdmin(tenantRow(n), VIEWER);
  }
  setRepoPermission(1, 1, 'admin');
  const probes = new ProbeBudget(10);
  await expect(lookups.read.repoAdmin(tenantRow(1), repositoryRow(1, 1), VIEWER, probes)).rejects.toBeInstanceOf(
    RoleLookupThrottledError,
  );
  expect(probes.remaining).toBe(10);
});

test('a failed lookup was still a lookup: it counts', async () => {
  const { fake, lookups } = manyTenants();
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    fake.failNext('getOrgMembership', new Error('GitHub is down'));
    await expect(lookups.read.orgAdmin(tenantRow(1), VIEWER)).rejects.toThrow('GitHub is down');
  }
  await expect(lookups.read.orgAdmin(tenantRow(1), VIEWER)).rejects.toBeInstanceOf(RoleLookupThrottledError);
});
