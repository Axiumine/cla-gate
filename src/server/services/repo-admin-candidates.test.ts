// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { addRepositories, installationDocument, namesOf, scopeDocuments } from './discovery-fixture/test-support.ts';
import { listRepoAdminCandidates } from './repo-admin-candidates.ts';
import { repoId, worldOfTwoTenants } from './store-fixture/test-support.ts';

// The candidates of the repository admin discovery (E11-S03): repo-scoped documents, not removed, one tenant only.

const REMOVED_AT = new Date('2026-06-01T12:00:00Z');

test('only repositories with a repo-scoped document are listed, with the GitHub installation id and the stored name', async () => {
  const { db, a } = await worldOfTwoTenants();
  await installationDocument(db, a.installation.id);
  await scopeDocuments(db, a.installation.id, namesOf(1, [2]));
  expect(await listRepoAdminCandidates(db, a.installation.id, 10)).toEqual([
    { github_installation_id: 100, full_name: 'org-1/repo-2', removed_at: null },
  ]);
});

test('an installation-wide document alone makes no repository a candidate', async () => {
  const { db, a } = await worldOfTwoTenants();
  await installationDocument(db, a.installation.id);
  expect(await listRepoAdminCandidates(db, a.installation.id, 10)).toEqual([]);
});

test('a repository with two documents is listed once', async () => {
  const { db, a } = await worldOfTwoTenants();
  await scopeDocuments(db, a.installation.id, namesOf(1, [1]), ['Individual CLA', 'Corporate CLA']);
  const rows = await listRepoAdminCandidates(db, a.installation.id, 10);
  expect(rows.map((row) => row.full_name)).toEqual(['org-1/repo-1']);
});

test('a removed repository is not listed, with its document or not', async () => {
  const { db, store, a } = await worldOfTwoTenants();
  await scopeDocuments(db, a.installation.id, namesOf(1, [1, 2]));
  await store.markRepositoriesRemoved(a.installation.id, [repoId(1, 1)], REMOVED_AT);
  const rows = await listRepoAdminCandidates(db, a.installation.id, 10);
  expect(rows.map((row) => row.full_name)).toEqual(['org-1/repo-2']);
});

test('the rows come in repository id order, which is the order the repositories were stored in, and at most `limit` of them', async () => {
  const { db, store, a } = await worldOfTwoTenants();
  await addRepositories(store, a.installation.id, 1, [9, 7, 8]);
  await scopeDocuments(db, a.installation.id, namesOf(1, [1, 2, 9, 7, 8]));
  const rows = await listRepoAdminCandidates(db, a.installation.id, 4);
  expect(rows.map((row) => row.full_name)).toEqual(namesOf(1, [1, 2, 9, 7]));
});

test("another tenant's repositories and documents are never listed, whatever the limit", async () => {
  const { db, a, b } = await worldOfTwoTenants();
  await scopeDocuments(db, a.installation.id, namesOf(1, [1]));
  await scopeDocuments(db, b.installation.id, namesOf(2, [1, 2]));
  const own = await listRepoAdminCandidates(db, a.installation.id, 100);
  const other = await listRepoAdminCandidates(db, b.installation.id, 100);
  expect([own.map((row) => row.full_name), other.map((row) => row.full_name)]).toEqual([
    ['org-1/repo-1'],
    ['org-2/repo-1', 'org-2/repo-2'],
  ]);
  expect([own[0]?.github_installation_id, other[0]?.github_installation_id]).toEqual([100, 200]);
});
