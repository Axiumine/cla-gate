// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { scopeDocuments } from './discovery-fixture/test-support.ts';
import { id } from './github-contract/test-support.ts';
import { GitHubUnavailableError } from './ports/github-errors.ts';
import { listRepositoryPage, type RepositoryListRequest } from './repository-list.ts';
import { VIEWER } from './role-fixture/test-support.ts';
import type { CachedRepoAdminLookup } from './role-lookups.ts';
import { worldOfTwoTenants } from './store-fixture/test-support.ts';

// The page of repositories, below the HTTP layer (E14-S01): what an org admin and a repository admin are given, and how many
// repositories a page asks the lookups about. The lookup is a stand-in that says what it is told to, and records every
// repository it was asked about.

const FIRST_PAGE: RepositoryListRequest = { limit: 50, from: null, q: null, enabled: null };

/** A lookup that confirms the repositories named in `administered` (by full name), and keeps what it was asked and how many ran at once. */
function recordingLookup(administered: ReadonlySet<string> | 'all') {
  const asked: { installation: number; githubInstallationId: number; fullName: string; githubRepoId: number }[] = [];
  const state = { running: 0, mostRunning: 0 };
  const lookup: CachedRepoAdminLookup = async (installation, repository, viewer) => {
    expect(viewer).toBe(VIEWER);
    asked.push({
      installation: installation.id,
      githubInstallationId: installation.github_installation_id,
      fullName: repository.full_name,
      githubRepoId: repository.github_repo_id,
    });
    state.running += 1;
    state.mostRunning = Math.max(state.mostRunning, state.running);
    await Promise.resolve();
    state.running -= 1;
    return administered === 'all' || administered.has(repository.full_name);
  };
  return { lookup, asked, state };
}

async function setup(administered: ReadonlySet<string> | 'all' = 'all') {
  const world = await worldOfTwoTenants();
  const recorder = recordingLookup(administered);
  const orgAdminPage = (request: Partial<RepositoryListRequest> = {}) =>
    listRepositoryPage(
      { db: world.db, lookup: recorder.lookup },
      { installationId: world.a.installation.id, role: 'org_admin' },
      VIEWER,
      { ...FIRST_PAGE, ...request },
    );
  const repoAdminPage = (request: Partial<RepositoryListRequest> = {}) =>
    listRepositoryPage(
      { db: world.db, lookup: recorder.lookup },
      { installationId: world.a.installation.id, role: 'repo_admin' },
      VIEWER,
      { ...FIRST_PAGE, ...request },
    );
  /** Stores `org-<n>/repo-3` to `repo-<count>` for tenant `n`, each with a repo-scoped document. */
  const crowd = async (n: 1 | 2, count: number) => {
    const tenant = n === 1 ? world.a : world.b;
    const indexes = Array.from({ length: count - 2 }, (_unused, index) => index + 3);
    await world.store.upsertRepositories(
      tenant.installation.id,
      indexes.map((index) => ({
        githubRepoId: id(n * 10_000 + index),
        fullName: `org-${n}/repo-${String(index).padStart(3, '0')}`,
      })),
    );
    await scopeDocuments(
      world.db,
      tenant.installation.id,
      indexes.map((index) => `org-${n}/repo-${String(index).padStart(3, '0')}`),
    );
  };
  return { ...world, ...recorder, orgAdminPage, repoAdminPage, crowd };
}

test('an org admin is given the repositories as they are stored and no lookup of any permission is made', async () => {
  const { orgAdminPage, asked } = await setup();
  const page = await orgAdminPage();
  expect(page.items.map((item) => [item.fullName, item.canAdminister, item.document])).toEqual([
    ['org-1/repo-1', true, null],
    ['org-1/repo-2', true, null],
  ]);
  expect(page.next).toBeNull();
  expect(asked).toEqual([]);
});

test('the page of an org admin is cut at the limit, and the position of the next page is the first repository left over', async () => {
  const { orgAdminPage, crowd } = await setup();
  await crowd(1, 6);
  const page = await orgAdminPage({ limit: 3 });
  expect(page.items.map((item) => item.fullName)).toEqual(['org-1/repo-003', 'org-1/repo-004', 'org-1/repo-005']);
  expect(page.next?.fullName).toBe('org-1/repo-006');
  const rest = await orgAdminPage({ limit: 3, from: page.next });
  expect(rest.items.map((item) => item.fullName)).toEqual(['org-1/repo-006', 'org-1/repo-1', 'org-1/repo-2']);
  expect(rest.next).toBeNull();
});

test('a repository admin is given the candidates the lookup confirms, and only the candidates are asked about', async () => {
  const { repoAdminPage, asked, db, a } = await setup(new Set(['org-1/repo-2']));
  await scopeDocuments(db, a.installation.id, ['org-1/repo-1', 'org-1/repo-2']);
  const page = await repoAdminPage();
  expect(page.items.map((item) => item.fullName)).toEqual(['org-1/repo-2']);
  expect(asked.map((call) => call.fullName)).toEqual(['org-1/repo-1', 'org-1/repo-2']);
  expect(asked.map((call) => [call.installation, call.githubInstallationId])).toEqual([
    [a.installation.id, 100],
    [a.installation.id, 100],
  ]);
  expect(asked.map((call) => call.githubRepoId)).toEqual([10_001, 10_002]);
});

test('a repository without a repo-scoped document is never asked about and never listed for a repository admin', async () => {
  const { repoAdminPage, asked, db, a } = await setup();
  await scopeDocuments(db, a.installation.id, ['org-1/repo-2']);
  const page = await repoAdminPage();
  expect(page.items.map((item) => item.fullName)).toEqual(['org-1/repo-2']);
  expect(asked.map((call) => call.fullName)).toEqual(['org-1/repo-2']);
});

test('a page of a repository admin asks about at most 50 repositories, whatever the limit, and the next page starts at the 51st', async () => {
  const { repoAdminPage, asked, crowd } = await setup();
  await crowd(1, 80);
  const page = await repoAdminPage({ limit: 100 });
  expect(asked).toHaveLength(50);
  expect(page.items).toHaveLength(50);
  expect(page.next?.fullName).toBe('org-1/repo-053');
});

test('a page of a repository admin asks about no more repositories than its limit', async () => {
  const { repoAdminPage, asked, crowd } = await setup();
  await crowd(1, 20);
  const page = await repoAdminPage({ limit: 4 });
  expect(asked).toHaveLength(4);
  expect(page.items).toHaveLength(4);
  expect(page.next?.fullName).toBe('org-1/repo-007');
});

test('a page of a repository admin may hold fewer repositories than were asked about and still have a next page', async () => {
  const { repoAdminPage, crowd } = await setup(new Set(['org-1/repo-006']));
  await crowd(1, 10);
  const first = await repoAdminPage({ limit: 3 });
  expect(first.items).toEqual([]);
  expect(first.next?.fullName).toBe('org-1/repo-006');
  const second = await repoAdminPage({ limit: 3, from: first.next });
  expect(second.items.map((item) => item.fullName)).toEqual(['org-1/repo-006']);
  expect(second.next?.fullName).toBe('org-1/repo-009');
});

test('the lookups of a page run five at a time', async () => {
  const { repoAdminPage, state, crowd } = await setup();
  await crowd(1, 30);
  await repoAdminPage({ limit: 12 });
  expect(state.mostRunning).toBe(5);
});

test('a lookup that fails fails the page: it is never a page of none', async () => {
  const world = await setup();
  await world.crowd(1, 5);
  const failing = listRepositoryPage(
    {
      db: world.db,
      lookup: () => Promise.reject(new GitHubUnavailableError('down')),
    },
    { installationId: world.a.installation.id, role: 'repo_admin' },
    VIEWER,
    FIRST_PAGE,
  );
  await expect(failing).rejects.toBeInstanceOf(GitHubUnavailableError);
});

test('the filters narrow what a repository admin is asked about', async () => {
  const { repoAdminPage, asked, crowd, db, a } = await setup();
  await crowd(1, 8);
  await db
    .updateTable('repositories')
    .set({ enabled: true })
    .where('installation_id', '=', a.installation.id)
    .where('full_name', 'in', ['org-1/repo-005', 'org-1/repo-006'])
    .execute();
  const byName = await repoAdminPage({ q: 'REPO-00' });
  expect(byName.items).toHaveLength(6);
  asked.length = 0;
  const enabled = await repoAdminPage({ enabled: true });
  expect(enabled.items.map((item) => item.fullName)).toEqual(['org-1/repo-005', 'org-1/repo-006']);
  expect(asked.map((call) => call.fullName)).toEqual(['org-1/repo-005', 'org-1/repo-006']);
});

test('the candidates of another tenant are never asked about', async () => {
  const { repoAdminPage, asked, crowd, b } = await setup();
  await crowd(1, 4);
  await crowd(2, 9);
  await repoAdminPage();
  expect(asked.every((call) => call.installation !== b.installation.id)).toBe(true);
  expect(asked.every((call) => call.fullName.startsWith('org-1/'))).toBe(true);
});
