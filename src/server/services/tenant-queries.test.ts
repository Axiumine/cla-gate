// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { rowId } from '../adapters/db/test-support.ts';
import { installationOf, listed, repoId, worldOfTwoTenants } from './store-fixture/test-support.ts';
import { findAdmittedTenantRows, findTenantRows, installationOfRepository } from './tenant-queries.ts';

// What the tenant guard reads (E11-S05), over a database that holds two tenants with two repositories each.

/** The two tenants, a third that the admission policy rejected, and `repositories.id` of one repository of each. */
async function world() {
  const base = await worldOfTwoTenants();
  const rejected = await base.store.upsertInstallation(
    installationOf(3, { admission: { status: 'rejected', reason: 'account_not_allowed', decidedAt: new Date() } }),
  );
  await base.store.upsertRepositories(rejected.id, [listed(3, 1)]);
  const rowOf = async (githubRepoId: number) =>
    (
      await base.db
        .selectFrom('repositories')
        .select('id')
        .where('github_repo_id', '=', githubRepoId)
        .executeTakeFirstOrThrow()
    ).id;
  return {
    ...base,
    rejected,
    a1: await rowOf(repoId(1, 1)),
    a2: await rowOf(repoId(1, 2)),
    b1: await rowOf(repoId(2, 1)),
    r1: await rowOf(repoId(3, 1)),
  };
}

test('an installation is read as stored, with no repository when none is asked for', async () => {
  const { db, a } = await world();
  const rows = await findTenantRows(db, { installationId: a.installation.id }, null);
  expect(rows).toEqual({ installation: a.installation, repository: null });
});

test('an installation that is not stored is null', async () => {
  const { db } = await world();
  expect(await findTenantRows(db, { installationId: rowId(987_654) }, null)).toBeNull();
});

test('a repository is read with its installation, and the installation of the repository is its own', async () => {
  const { db, a, a1 } = await world();
  const rows = await findTenantRows(db, { installationId: a.installation.id }, a1);
  expect(rows?.installation.id).toBe(a.installation.id);
  expect(rows?.repository).toMatchObject({ id: a1, installation_id: a.installation.id, full_name: 'org-1/repo-1' });
});

test("a repository of another installation is null: it is read with the installation id, so one tenant never reaches another's row", async () => {
  const { db, a, b, b1 } = await world();
  expect(await findTenantRows(db, { installationId: a.installation.id }, b1)).toBeNull();
  expect(await findTenantRows(db, { installationId: b.installation.id }, b1)).not.toBeNull();
});

test('a repository that is unknown or removed is null', async () => {
  const { db, a, a1, a2, store } = await world();
  expect(await findTenantRows(db, { installationId: a.installation.id }, a1 + 100_000)).toBeNull();
  await store.markRepositoriesRemoved(a.installation.id, [repoId(1, 2)], new Date());
  expect(await findTenantRows(db, { installationId: a.installation.id }, a2)).toBeNull();
  expect(await findTenantRows(db, { installationId: a.installation.id }, a1)).not.toBeNull();
});

test('every state of an installation is read, whatever the admission policy said', async () => {
  const { db, rejected, r1 } = await world();
  expect((await findTenantRows(db, { installationId: rejected.id }, r1))?.installation.admission_status).toBe(
    'rejected',
  );
});

test('an admitted tenant is read, and a rejected one is null like an unknown one', async () => {
  const { db, a, rejected, a1, r1 } = await world();
  expect((await findAdmittedTenantRows(db, { installationId: a.installation.id }, a1))?.repository?.id).toBe(a1);
  expect(await findAdmittedTenantRows(db, { installationId: rejected.id }, null)).toBeNull();
  expect(await findAdmittedTenantRows(db, { installationId: rejected.id }, r1)).toBeNull();
  expect(await findAdmittedTenantRows(db, { installationId: rowId(987_654) }, null)).toBeNull();
});

test("a suspended or deleted tenant is still an admitted one: what it means for access is the guard's to decide", async () => {
  const { db, store, a, b } = await world();
  await store.upsertInstallation(installationOf(1, { suspendedAt: new Date() }));
  await store.upsertInstallation(installationOf(2, { deletedAt: new Date() }));
  expect(await findAdmittedTenantRows(db, { installationId: a.installation.id }, null)).not.toBeNull();
  expect(await findAdmittedTenantRows(db, { installationId: b.installation.id }, null)).not.toBeNull();
});

test('the installation of a repository is found from the repository alone, and not for one that is unknown or removed', async () => {
  const { db, a, b, a1, a2, b1, store } = await world();
  expect(await installationOfRepository(db, a1)).toBe(a.installation.id);
  expect(await installationOfRepository(db, b1)).toBe(b.installation.id);
  expect(await installationOfRepository(db, a1 + 100_000)).toBeNull();
  await store.markRepositoriesRemoved(a.installation.id, [repoId(1, 2)], new Date());
  expect(await installationOfRepository(db, a2)).toBeNull();
});
