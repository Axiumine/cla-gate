// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { createLogger } from '../adapters/http/logger.ts';
import { captureLogs } from '../test-support.ts';
import {
  addRepositories,
  githubOfTwoTenants,
  installationDocument,
  namesOf,
  range,
  scopeDocuments,
  TENANT_ONE,
} from './discovery-fixture/test-support.ts';
import { id, installation } from './github-contract/test-support.ts';
import { GitHubUnavailableError, InstallationNotAdmittedError } from './ports/github-errors.ts';
import { PROBE_BUDGETS, ProbeBudget } from './probe-budget.ts';
import { createRepoAdminLookup } from './repo-admin.ts';
import { createRepoAdminDiscovery } from './repo-admin-discovery.ts';
import { VIEWER, VIEWER_ID } from './role-fixture/test-support.ts';
import { repoId, worldOfTwoTenants } from './store-fixture/test-support.ts';
import { FakeGate, FakeGitHub } from './test-support.ts';

// The role-in-installation rule of E11-S01 (E11-S03) over a real database and the in-memory GitHub: the permission lookup
// is the real one, so the calls that reach GitHub are the fake's record. How the probes are scheduled is in
// repo-admin-discovery-schedule.test.ts.

/** The discovery over a migrated database holding the two tenants (two repositories each) and a GitHub that serves both. */
async function setup() {
  const world = await worldOfTwoTenants();
  const fake = githubOfTwoTenants();
  const logs = captureLogs();
  const lookup = createRepoAdminLookup({ github: fake, log: createLogger({ logLevel: 'info' }, logs.destination) });
  return { ...world, fake, discover: createRepoAdminDiscovery({ db: world.db, lookup }) };
}

/** The viewer holds this permission, with their own numeric id, on `org-<tenant>/repo-<index>` (installation `tenant * 100`). */
function grant(
  fake: FakeGitHub,
  tenant: 1 | 2,
  index: number,
  permission: 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none',
): void {
  fake.addRepositoryPermission(id(tenant * 100), `org-${tenant}/repo-${index}`, 'alice', {
    permission,
    userId: VIEWER_ID,
  });
}

test('an admin of a repository with a repo-scoped document has a role in the installation', async () => {
  const { db, a, fake, discover } = await setup();
  await scopeDocuments(db, a.installation.id, namesOf(1, [2]));
  grant(fake, 1, 2, 'admin');
  expect(await discover(VIEWER, a.installation.id, new ProbeBudget(100))).toEqual({
    role: 'repo_admin',
    truncated: false,
  });
});

test.each([
  ['maintain', 'maintain'],
  ['write', 'write'],
  ['triage', 'triage'],
  ['read', 'read'],
  ['none', 'none'],
] as const)('a viewer with only %s on the repository has no role', async (_name, permission) => {
  const { db, a, fake, discover } = await setup();
  await scopeDocuments(db, a.installation.id, namesOf(1, [1]));
  grant(fake, 1, 1, permission);
  expect(await discover(VIEWER, a.installation.id, new ProbeBudget(100))).toEqual({ role: 'none', truncated: false });
});

test('a recycled login (the same login, another numeric id) has no role', async () => {
  const { db, a, fake, discover } = await setup();
  await scopeDocuments(db, a.installation.id, namesOf(1, [1]));
  fake.addRepositoryPermission(TENANT_ONE, 'org-1/repo-1', 'alice', {
    permission: 'admin',
    userId: id(VIEWER_ID + 1),
  });
  expect(await discover(VIEWER, a.installation.id, new ProbeBudget(100))).toEqual({ role: 'none', truncated: false });
});

test('a repository that was renamed since the last sync answers 404 and gives no role', async () => {
  const { db, store, a, fake, discover } = await setup();
  await scopeDocuments(db, a.installation.id, namesOf(1, [1]));
  grant(fake, 1, 1, 'admin');
  await store.upsertRepositories(a.installation.id, [{ githubRepoId: repoId(1, 1), fullName: 'org-1/renamed' }]);
  expect(await discover(VIEWER, a.installation.id, new ProbeBudget(100))).toEqual({ role: 'none', truncated: false });
  expect(fake.calls).toEqual([{ method: 'getRepositoryPermission', installationId: 100 }]);
});

test('with no repository that carries a repo-scoped document nothing is asked: no role, and not truncated', async () => {
  const { db, a, fake, discover } = await setup();
  await installationDocument(db, a.installation.id);
  grant(fake, 1, 1, 'admin');
  expect(await discover(VIEWER, a.installation.id, new ProbeBudget(100))).toEqual({ role: 'none', truncated: false });
  expect(fake.calls).toEqual([]);
});

test('a removed repository is skipped, even though its document is still there and the viewer is admin of it', async () => {
  const { db, store, a, fake, discover } = await setup();
  await scopeDocuments(db, a.installation.id, namesOf(1, [1, 2]));
  grant(fake, 1, 1, 'admin');
  await store.markRepositoriesRemoved(a.installation.id, [repoId(1, 1)], new Date('2026-06-01T12:00:00Z'));
  expect(await discover(VIEWER, a.installation.id, new ProbeBudget(100))).toEqual({ role: 'none', truncated: false });
  expect(fake.calls).toHaveLength(1);
});

test("another tenant's repositories are never asked about: admin of tenant 2's repository is nothing in tenant 1", async () => {
  const { db, a, b, fake, discover } = await setup();
  await scopeDocuments(db, a.installation.id, namesOf(1, [1]));
  await scopeDocuments(db, b.installation.id, namesOf(2, [1]));
  grant(fake, 2, 1, 'admin');
  expect(await discover(VIEWER, a.installation.id, new ProbeBudget(100))).toEqual({ role: 'none', truncated: false });
  expect(await discover(VIEWER, b.installation.id, new ProbeBudget(100))).toEqual({
    role: 'repo_admin',
    truncated: false,
  });
  expect(fake.calls.map((call) => call.installationId)).toEqual([100, 200]);
});

test('150 repositories and a budget of 100: the first 100 are asked, none is admin, and the answer is truncated', async () => {
  const { db, store, a, fake, discover } = await setup();
  await addRepositories(store, a.installation.id, 1, range(3, 150));
  await scopeDocuments(db, a.installation.id, namesOf(1, range(1, 150)));
  const budget = new ProbeBudget(100);
  expect(await discover(VIEWER, a.installation.id, budget)).toEqual({ role: 'none', truncated: true });
  expect(fake.calls).toHaveLength(100);
  expect(budget.remaining).toBe(0);
});

test('an admin of the 101st repository is not found with a budget of 100: only the first 100 are asked', async () => {
  const { db, store, a, fake, discover } = await setup();
  await addRepositories(store, a.installation.id, 1, range(3, 150));
  await scopeDocuments(db, a.installation.id, namesOf(1, range(1, 150)));
  grant(fake, 1, 101, 'admin');
  expect(await discover(VIEWER, a.installation.id, new ProbeBudget(100))).toEqual({ role: 'none', truncated: true });
});

test('an admin of the 100th repository is found with a budget of 100', async () => {
  const { db, store, a, fake, discover } = await setup();
  await addRepositories(store, a.installation.id, 1, range(3, 150));
  await scopeDocuments(db, a.installation.id, namesOf(1, range(1, 150)));
  grant(fake, 1, 100, 'admin');
  expect(await discover(VIEWER, a.installation.id, new ProbeBudget(100))).toEqual({
    role: 'repo_admin',
    truncated: false,
  });
});

test('exactly as many repositories as the budget is complete: not truncated; one more is truncated', async () => {
  const { db, store, a, discover } = await setup();
  await addRepositories(store, a.installation.id, 1, range(3, 11));
  await scopeDocuments(db, a.installation.id, namesOf(1, range(1, 11)));
  expect(await discover(VIEWER, a.installation.id, new ProbeBudget(11))).toEqual({ role: 'none', truncated: false });
  expect(await discover(VIEWER, a.installation.id, new ProbeBudget(10))).toEqual({ role: 'none', truncated: true });
});

test('the denial path asks at most 10 repositories, always the same 10, however often a stranger asks', async () => {
  const { db, store, a, fake, discover } = await setup();
  await addRepositories(store, a.installation.id, 1, range(3, 25));
  await scopeDocuments(db, a.installation.id, namesOf(1, range(1, 25)));
  for (let request = 0; request < 3; request += 1) {
    expect(await discover(VIEWER, a.installation.id, new ProbeBudget(PROBE_BUDGETS.denial))).toEqual({
      role: 'none',
      truncated: true,
    });
  }
  expect(fake.calls).toHaveLength(30);
  grant(fake, 1, 11, 'admin');
  expect(await discover(VIEWER, a.installation.id, new ProbeBudget(PROBE_BUDGETS.denial))).toEqual({
    role: 'none',
    truncated: true,
  });
  grant(fake, 1, 10, 'admin');
  expect(await discover(VIEWER, a.installation.id, new ProbeBudget(PROBE_BUDGETS.denial))).toEqual({
    role: 'repo_admin',
    truncated: false,
  });
});

test('a budget that is part spent leaves the probes it has left: three remaining ask three repositories', async () => {
  const { db, store, a, fake, discover } = await setup();
  await addRepositories(store, a.installation.id, 1, range(3, 8));
  await scopeDocuments(db, a.installation.id, namesOf(1, range(1, 8)));
  const budget = new ProbeBudget(5);
  budget.spend();
  budget.spend();
  expect(await discover(VIEWER, a.installation.id, budget)).toEqual({ role: 'none', truncated: true });
  expect(fake.calls).toHaveLength(3);
  expect(budget.remaining).toBe(0);
});

test('an empty budget asks nothing, not even the database: no role, truncated', async () => {
  const { db, a, fake } = await setup();
  const lookups: string[] = [];
  const discover = createRepoAdminDiscovery({
    db,
    lookup: (_installation, repository) => {
      lookups.push(repository.full_name);
      return Promise.resolve(true);
    },
  });
  await scopeDocuments(db, a.installation.id, namesOf(1, [1]));
  expect(await discover(VIEWER, a.installation.id, new ProbeBudget(0))).toEqual({ role: 'none', truncated: true });
  expect([lookups, fake.calls]).toEqual([[], []]);
});

test('an outage is thrown, not read as no role', async () => {
  const { db, a, fake, discover } = await setup();
  await scopeDocuments(db, a.installation.id, namesOf(1, [1]));
  fake.failNext('getRepositoryPermission', new GitHubUnavailableError('down'));
  await expect(discover(VIEWER, a.installation.id, new ProbeBudget(10))).rejects.toBeInstanceOf(GitHubUnavailableError);
});

test('an installation the instance does not serve is refused by the gate before any request', async () => {
  const { db, a } = await worldOfTwoTenants();
  const gate = new FakeGate();
  const fake = new FakeGitHub({ gate });
  fake.addInstallation(installation(100, 'org-1'));
  gate.refuse(TENANT_ONE, 'suspended');
  const log = createLogger({ logLevel: 'info' }, captureLogs().destination);
  const discover = createRepoAdminDiscovery({ db, lookup: createRepoAdminLookup({ github: fake, log }) });
  await scopeDocuments(db, a.installation.id, namesOf(1, [1]));
  await expect(discover(VIEWER, a.installation.id, new ProbeBudget(10))).rejects.toEqual(
    new InstallationNotAdmittedError('suspended'),
  );
  expect(fake.calls).toEqual([]);
});
