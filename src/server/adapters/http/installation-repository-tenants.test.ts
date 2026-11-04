// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { INSTALLATIONS_PATH, installationListSchema, repositoryPageSchema } from '../../../shared/installations.ts';
import { recordAdminSeen } from '../../services/admin-ledger-queries.ts';
import { id } from '../../services/github-contract/test-support.ts';
import { GitHubRateLimitedError, GitHubUnavailableError } from '../../services/ports/github-errors.ts';
import {
  bodyOf,
  failureOf,
  listRepositories,
  namesOfPage,
  storeRepositories,
} from './installation-list-fixture/test-support.ts';
import { repositoryCursor } from './repository-cursor.ts';
import { guardWorld, PEOPLE, shapeOf } from './tenant-guard-fixture/test-support.ts';

// The repository list across tenants and when GitHub cannot say who a person is (E14-S01). Tenant 1 is the one under test
// and tenant 2 the other admitted tenant; `admin1` administers the organisation of 1 and is a plain member (a contributor,
// with no role) of the organisation of 2 once a test says so.

const UNKNOWN_INSTALLATION = 999_999;

/** The guard world where `admin1` is a plain member of the organisation of tenant 2 too. */
async function worldWhereAdmin1IsContributorOfTenant2() {
  const world = await guardWorld();
  world.fake.addMembership(id(200), 'org-2', `login-${PEOPLE.admin1}`, {
    state: 'active',
    role: 'member',
    userId: id(PEOPLE.admin1),
  });
  return world;
}

test('an admin of tenant 1 who is a contributor of tenant 2 sees only tenant 1: in the installations, and in the repositories of both', async () => {
  const world = await worldWhereAdmin1IsContributorOfTenant2();
  const installations = await world.ask('GET', INSTALLATIONS_PATH, 'admin1');
  expect(bodyOf(installations, installationListSchema).map((row) => row.id)).toEqual([world.tenants.t1]);
  const own = await listRepositories(world, 'admin1', world.tenants.t1);
  expect(namesOfPage(own)).toEqual(['org-1/repo-1', 'org-1/repo-2']);
  const other = await listRepositories(world, 'admin1', world.tenants.t2);
  expect(failureOf(other)).toEqual([404, 'not_found']);
  expect(other.body).not.toContain('org-2');
});

test('what is refused for tenant 2 is the answer for an installation that does not exist, byte for byte', async () => {
  const world = await worldWhereAdmin1IsContributorOfTenant2();
  const contributor = await listRepositories(world, 'admin1', world.tenants.t2);
  const stranger = await listRepositories(world, 'outsider', world.tenants.t1);
  const unknown = await listRepositories(world, 'admin1', UNKNOWN_INSTALLATION);
  const rejected = await listRepositories(world, 'admin1', world.tenants.rejected);
  expect(shapeOf(contributor)).toEqual(shapeOf(unknown));
  expect(shapeOf(stranger)).toEqual(shapeOf(unknown));
  expect(shapeOf(rejected)).toEqual(shapeOf(unknown));
  expect(failureOf(unknown)).toEqual([404, 'not_found']);
});

test('a name that only another tenant has is never found: q matches what tenant 1 has, and nothing of tenant 2', async () => {
  const world = await worldWhereAdmin1IsContributorOfTenant2();
  await storeRepositories(world, { n: 2, installationId: world.tenants.t2 }, ['org-2/secret-1', 'org-1/repo-9']);
  const own = await listRepositories(world, 'admin1', world.tenants.t1, '?q=secret');
  expect(bodyOf(own, repositoryPageSchema)).toEqual({ items: [], nextCursor: null });
  const similar = await listRepositories(world, 'admin1', world.tenants.t1, '?q=repo-');
  expect(namesOfPage(similar)).toEqual(['org-1/repo-1', 'org-1/repo-2']);
  const tenantTwoIds = await world.db
    .selectFrom('repositories')
    .select('id')
    .where('installation_id', '=', world.tenants.t2)
    .execute();
  const listed = bodyOf(await listRepositories(world, 'admin1', world.tenants.t1), repositoryPageSchema).items;
  expect(listed.map((item) => item.id).filter((rowId) => tenantTwoIds.some((row) => row.id === rowId))).toEqual([]);
});

test('a cursor made from a repository of tenant 2 only says where a page of tenant 1 starts, and no row of tenant 2 comes with it', async () => {
  const world = await worldWhereAdmin1IsContributorOfTenant2();
  const cursor = repositoryCursor({ fullName: 'org-1/repo-1', id: world.repositories.t2r1 });
  const response = await listRepositories(world, 'admin1', world.tenants.t1, `?cursor=${cursor}`);
  // The pair (full name, id) of the cursor sorts after `repo-1` of tenant 1, so the page starts at its `repo-2`.
  expect(bodyOf(response, repositoryPageSchema).items.map((item) => item.id)).toEqual([world.repositories.t1r2]);
});

test('the admin of tenant 2 sees tenant 2 only, and tenant 1 is a 404 for them', async () => {
  const world = await guardWorld();
  const own = await listRepositories(world, 'admin2', world.tenants.t2);
  expect(namesOfPage(own)).toEqual(['org-2/repo-1', 'org-2/repo-2', 'org-2/repo-3']);
  expect(failureOf(await listRepositories(world, 'admin2', world.tenants.t1))).toEqual([404, 'not_found']);
});

test('a repository admin of tenant 1 is a stranger to tenant 2, whose repositories carry no document of theirs', async () => {
  const world = await guardWorld();
  expect(failureOf(await listRepositories(world, 'repoAdmin1', world.tenants.t2))).toEqual([404, 'not_found']);
});

test('a suspended organisation can be read only by an org admin the ledger remembers, a suspended user account by its owner', async () => {
  const world = await guardWorld();
  expect(failureOf(await listRepositories(world, 'admin1', world.tenants.suspendedOrg))).toEqual([404, 'not_found']);
  const now = world.clock.now();
  await recordAdminSeen(world.db, { installationId: world.tenants.suspendedOrg }, parseGithubId(PEOPLE.admin1), {
    seenAt: now,
    refreshAtOrBefore: now,
  });
  const remembered = await listRepositories(world, 'admin1', world.tenants.suspendedOrg);
  expect(namesOfPage(remembered)).toEqual(['org-6/repo-1', 'org-6/repo-2', 'org-6/repo-3']);
  expect(failureOf(await listRepositories(world, 'repoAdmin1', world.tenants.suspendedOrg))).toEqual([
    404,
    'not_found',
  ]);
  const owned = await listRepositories(world, 'owner', world.tenants.suspendedUser);
  expect(namesOfPage(owned)).toEqual(['org-4/repo-1', 'org-4/repo-2', 'org-4/repo-3']);
});

test('a request with no session is a 401', async () => {
  const world = await guardWorld();
  expect(failureOf(await listRepositories(world, undefined, world.tenants.t1))).toEqual([401, 'unauthorized']);
});

test('GitHub failing to tell who the person is gives a 502, and never an empty list', async () => {
  const world = await guardWorld();
  world.fake.failNext('getOrgMembership', new GitHubUnavailableError('down'));
  expect(failureOf(await listRepositories(world, 'admin1', world.tenants.t1))).toEqual([502, 'github_unavailable']);
  world.fake.failNext('getRepositoryPermission', new GitHubUnavailableError('down'));
  expect(failureOf(await listRepositories(world, 'repoAdmin1', world.tenants.t1))).toEqual([502, 'github_unavailable']);
});

test('GitHub limiting the installation gives a 503 github_rate_limited with its wait, for an org admin and a repository admin alike', async () => {
  const world = await guardWorld();
  world.fake.failNext('getOrgMembership', new GitHubRateLimitedError(42, 'primary'));
  const admin = await listRepositories(world, 'admin1', world.tenants.t1);
  expect(failureOf(admin)).toEqual([503, 'github_rate_limited']);
  expect(admin.headers['retry-after']).toBe('42');
  world.fake.failNext('getRepositoryPermission', new GitHubRateLimitedError(17, 'secondary'));
  const repoAdmin = await listRepositories(world, 'repoAdmin1', world.tenants.t1);
  expect(failureOf(repoAdmin)).toEqual([503, 'github_rate_limited']);
  expect(repoAdmin.headers['retry-after']).toBe('17');
});
