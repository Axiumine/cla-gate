// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { rowId } from '../adapters/db/test-support.ts';
import {
  getInstallationById,
  listLiveInstallationIds,
  markInstallationDeleted,
  markInstallationSynced,
} from './installation-queries.ts';
import { listActiveRepositoryIds } from './repository-queries.ts';
import { repoId, worldOfTwoTenants } from './store-fixture/test-support.ts';

// The queries the installation sync (E05-S08) adds. Each names its installation, and each is shown not to reach the
// other tenant.

const AT = new Date('2026-06-01T12:00:00Z');

test('the live installation ids are every installation that is not deleted, in ascending order', async () => {
  const { db, a, b } = await worldOfTwoTenants();
  expect(await listLiveInstallationIds(db)).toEqual([100, 200]);
  await markInstallationDeleted(db, a.installation.id, AT);
  expect(await listLiveInstallationIds(db)).toEqual([200]);
  await markInstallationDeleted(db, b.installation.id, AT);
  expect(await listLiveInstallationIds(db)).toEqual([]);
});

test('marking installation A deleted sets its deleted_at and last_synced_at and no column of B', async () => {
  const { db, a, b } = await worldOfTwoTenants();
  const untouched = await getInstallationById(db, b.installation.id);
  await markInstallationDeleted(db, a.installation.id, AT);
  expect(await getInstallationById(db, a.installation.id)).toMatchObject({ deleted_at: AT, last_synced_at: AT });
  expect(await getInstallationById(db, b.installation.id)).toEqual(untouched);
});

test('marking installation A synced sets its last_synced_at and no column of B', async () => {
  const { db, a, b } = await worldOfTwoTenants();
  const untouched = await getInstallationById(db, b.installation.id);
  await markInstallationSynced(db, a.installation.id, AT);
  expect(await getInstallationById(db, a.installation.id)).toMatchObject({ last_synced_at: AT, deleted_at: null });
  expect(await getInstallationById(db, b.installation.id)).toEqual(untouched);
});

test('an installation is read by its own id, and a missing one is an error, not another tenant', async () => {
  const { db, a, b } = await worldOfTwoTenants();
  expect((await getInstallationById(db, a.installation.id)).github_installation_id).toBe(100);
  expect((await getInstallationById(db, b.installation.id)).github_installation_id).toBe(200);
  await expect(getInstallationById(db, rowId(b.installation.id + 1000))).rejects.toThrow('no result');
});

test('the active repository ids of A are its own, ascending, without the removed ones and without any of B', async () => {
  const { db, store, a, b } = await worldOfTwoTenants();
  expect(await listActiveRepositoryIds(db, a.installation.id)).toEqual([repoId(1, 1), repoId(1, 2)]);
  expect(await listActiveRepositoryIds(db, b.installation.id)).toEqual([repoId(2, 1), repoId(2, 2)]);
  await store.markRepositoriesRemoved(a.installation.id, [repoId(1, 1)], AT);
  expect(await listActiveRepositoryIds(db, a.installation.id)).toEqual([repoId(1, 2)]);
  expect(await listActiveRepositoryIds(db, rowId(b.installation.id + 1000))).toEqual([]);
});
