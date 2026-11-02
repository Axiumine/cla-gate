// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { isActiveRepositoryOfAnotherInstallation } from './repository-queries.ts';
import { listed, repoId, worldOfTwoTenants } from './store-fixture/test-support.ts';

// Whether a repository is stored as active under another installation (E06-S05): existence only, never a row of the other
// tenant, and never the caller's own.

const REMOVED_AT = new Date('2026-06-01T12:00:00Z');

test("a repository stored under the other tenant is held by another installation, and the tenant's own is not", async () => {
  const { db, a, b } = await worldOfTwoTenants();
  expect(await isActiveRepositoryOfAnotherInstallation(db, a.installation.id, repoId(2, 1))).toBe(true);
  expect(await isActiveRepositoryOfAnotherInstallation(db, a.installation.id, repoId(1, 1))).toBe(false);
  expect(await isActiveRepositoryOfAnotherInstallation(db, b.installation.id, repoId(1, 2))).toBe(true);
  expect(await isActiveRepositoryOfAnotherInstallation(db, b.installation.id, repoId(2, 2))).toBe(false);
});

test('a repository nobody stored is held by no one', async () => {
  const { db, a } = await worldOfTwoTenants();
  expect(await isActiveRepositoryOfAnotherInstallation(db, a.installation.id, repoId(1, 99))).toBe(false);
  expect(
    await isActiveRepositoryOfAnotherInstallation(db, a.installation.id, parseGithubId(Number.MAX_SAFE_INTEGER)),
  ).toBe(false);
});

test('a repository the other tenant has lost access to is not held by it', async () => {
  const { db, store, a, b } = await worldOfTwoTenants();
  await store.markRepositoriesRemoved(b.installation.id, [repoId(2, 1)], REMOVED_AT);
  expect(await isActiveRepositoryOfAnotherInstallation(db, a.installation.id, repoId(2, 1))).toBe(false);
});

test('after a transfer the new tenant holds the repository, and the old tenant, whose row is kept, is the other one', async () => {
  const { db, store, a, b } = await worldOfTwoTenants();
  await store.markRepositoriesRemoved(a.installation.id, [repoId(1, 1)], REMOVED_AT);
  await store.upsertRepositories(b.installation.id, [listed(1, 1, 'org-2/repo-1')]);
  expect(await isActiveRepositoryOfAnotherInstallation(db, a.installation.id, repoId(1, 1))).toBe(true);
  expect(await isActiveRepositoryOfAnotherInstallation(db, b.installation.id, repoId(1, 1))).toBe(false);
});
