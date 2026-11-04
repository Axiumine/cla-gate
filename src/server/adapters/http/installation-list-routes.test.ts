// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { INSTALLATIONS_PATH, installationListSchema } from '../../../shared/installations.ts';
import { recordAdminSeen } from '../../services/admin-ledger-queries.ts';
import { id } from '../../services/github-contract/test-support.ts';
import { bodyOf, failureOf } from './installation-list-fixture/test-support.ts';
import { guardWorld, PEOPLE } from './tenant-guard-fixture/test-support.ts';

// GET /api/installations (E14-S01): the installations the signed-in person administers on this instance, and nothing else. The
// world is the six tenants of the guard tests: 1 and 2 active organisations, 3 rejected by the admission policy, 4 a suspended
// and 5 a deleted user account (both owned by `owner`), 6 a suspended organisation.

const LISTS = [
  ['admin1', [['t1', 'org_admin', false]]],
  ['admin2', [['t2', 'org_admin', false]]],
  ['repoAdmin1', [['t1', 'repo_admin', false]]],
  ['repoAdminOther', [['t1', 'repo_admin', false]]],
  ['member1', []],
  ['outsider', []],
  ['owner', [['suspendedUser', 'org_admin', true]]],
] as const;

test.each(LISTS)(
  '%s is shown the installations they hold a role in, with that role, and nothing else',
  async (person, expected) => {
    const world = await guardWorld();
    const response = await world.ask('GET', INSTALLATIONS_PATH, person);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const rows = bodyOf(response, installationListSchema);
    const tenantIds = new Map(Object.entries(world.tenants));
    expect(rows.map((row) => [row.id, row.role, row.suspended])).toEqual(
      expected.map(([tenant, role, suspended]) => [tenantIds.get(tenant), role, suspended]),
    );
  },
);

test('a row has the id of the installation, the account snapshot, the counts of the repositories that are not removed, and no truncation', async () => {
  const world = await guardWorld();
  await world.db.updateTable('repositories').set({ enabled: true }).where('id', '=', world.repositories.t1r1).execute();
  const response = await world.ask('GET', INSTALLATIONS_PATH, 'admin1');
  expect(bodyOf(response, installationListSchema)).toEqual([
    {
      id: world.tenants.t1,
      accountLogin: 'org-1',
      accountType: 'Organization',
      role: 'org_admin',
      suspended: false,
      // The third repository of the tenant is removed: it is in neither count.
      repositoryCount: 2,
      enabledCount: 1,
      truncated: false,
    },
  ]);
});

test('an active user account is listed for its owner with the type User, decided by the account id with no call to GitHub for it', async () => {
  const world = await guardWorld();
  await world.db
    .updateTable('installations')
    .set({ suspended_at: null })
    .where('id', '=', world.tenants.suspendedUser)
    .execute();
  const response = await world.ask('GET', INSTALLATIONS_PATH, 'owner');
  expect(
    bodyOf(response, installationListSchema).map((row) => [row.accountLogin, row.accountType, row.suspended]),
  ).toEqual([[`login-${PEOPLE.owner}`, 'User', false]]);
  expect(world.fake.calls.map((call) => call.installationId)).not.toContain(id(400));
});

test('an installation the admission policy rejected is never listed, even for the person GitHub says administers its organisation', async () => {
  const world = await guardWorld();
  world.fake.addMembership(id(300), 'org-3', `login-${PEOPLE.admin1}`, {
    state: 'active',
    role: 'admin',
    userId: id(PEOPLE.admin1),
  });
  const response = await world.ask('GET', INSTALLATIONS_PATH, 'admin1');
  expect(bodyOf(response, installationListSchema).map((row) => row.id)).toEqual([world.tenants.t1]);
  expect(world.fake.calls.map((call) => call.installationId)).not.toContain(id(300));
});

test('a deleted installation is not listed for the owner of its account', async () => {
  const world = await guardWorld();
  const response = await world.ask('GET', INSTALLATIONS_PATH, 'owner');
  expect(bodyOf(response, installationListSchema).map((row) => row.id)).not.toContain(world.tenants.deletedUser);
});

test('a suspended organisation is listed with suspended true for an org admin the ledger remembers, and for nobody else', async () => {
  const world = await guardWorld();
  const before = await world.ask('GET', INSTALLATIONS_PATH, 'admin1');
  expect(bodyOf(before, installationListSchema).map((row) => row.id)).toEqual([world.tenants.t1]);
  const now = world.clock.now();
  await recordAdminSeen(world.db, { installationId: world.tenants.suspendedOrg }, parseGithubId(PEOPLE.admin1), {
    seenAt: now,
    refreshAtOrBefore: now,
  });
  const after = await world.ask('GET', INSTALLATIONS_PATH, 'admin1');
  expect(bodyOf(after, installationListSchema).map((row) => [row.accountLogin, row.role, row.suspended])).toEqual([
    ['org-1', 'org_admin', false],
    ['org-6', 'org_admin', true],
  ]);
  // GitHub refuses the tokens of a suspended installation: it is never asked about it (installation 600).
  expect(world.fake.calls.map((call) => call.installationId)).not.toContain(id(600));
  const stranger = await world.ask('GET', INSTALLATIONS_PATH, 'repoAdmin1');
  expect(bodyOf(stranger, installationListSchema).map((row) => row.id)).toEqual([world.tenants.t1]);
});

test('the rows come by account login, not in the order the installations were stored in', async () => {
  const world = await guardWorld();
  const now = world.clock.now();
  await recordAdminSeen(world.db, { installationId: world.tenants.suspendedOrg }, parseGithubId(PEOPLE.owner), {
    seenAt: now,
    refreshAtOrBefore: now,
  });
  // The user account of `owner` was stored before the organisation (4 before 6): renamed, it now sorts after it.
  await world.db
    .updateTable('installations')
    .set({ account_login: 'zzz-owner' })
    .where('id', '=', world.tenants.suspendedUser)
    .execute();
  const response = await world.ask('GET', INSTALLATIONS_PATH, 'owner');
  expect(bodyOf(response, installationListSchema).map((row) => row.id)).toEqual([
    world.tenants.suspendedOrg,
    world.tenants.suspendedUser,
  ]);
});

test('a request with no session is 401 and any query parameter is a 400 that names no row', async () => {
  const world = await guardWorld();
  expect(failureOf(await world.ask('GET', INSTALLATIONS_PATH))).toEqual([401, 'unauthorized']);
  expect(
    failureOf(await world.ask('GET', `${INSTALLATIONS_PATH}?installationId=${world.tenants.t2}`, 'admin1')),
  ).toEqual([400, 'bad_request']);
});
