// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { twoTenants } from './tenant-fixture/test-support.ts';
import { assertRepositoryInTenant, TenantMismatchError } from './tenant-scope.ts';
import { migratedTestDatabase, rowId } from './test-support.ts';

// The helper of background work (E11-S06): a job asserts that the repository it was queued for is in the tenant it was
// queued for before its first write.

async function world() {
  const { db } = await migratedTestDatabase();
  return { db, ...(await twoTenants(db)) };
}

test('a repository of the tenant passes, plain or with a document of its own', async () => {
  const { db, t1 } = await world();
  const scope = { installationId: t1.installationId };
  await expect(assertRepositoryInTenant(db, scope, t1.plain.repositoryId)).resolves.toBeUndefined();
  await expect(assertRepositoryInTenant(db, scope, t1.scoped.repositoryId)).resolves.toBeUndefined();
});

test('a repository of another tenant throws TenantMismatchError, whichever tenant asks', async () => {
  const { db, t1, t2 } = await world();
  await expect(
    assertRepositoryInTenant(db, { installationId: t1.installationId }, t2.plain.repositoryId),
  ).rejects.toBeInstanceOf(TenantMismatchError);
  await expect(
    assertRepositoryInTenant(db, { installationId: t2.installationId }, t1.scoped.repositoryId),
  ).rejects.toBeInstanceOf(TenantMismatchError);
});

test('a repository that does not exist is a mismatch too', async () => {
  const { db, t1 } = await world();
  await expect(assertRepositoryInTenant(db, { installationId: t1.installationId }, 987_654)).rejects.toBeInstanceOf(
    TenantMismatchError,
  );
});

test('an installation that does not exist holds no repository', async () => {
  const { db, t1 } = await world();
  await expect(
    assertRepositoryInTenant(db, { installationId: rowId(987_654) }, t1.plain.repositoryId),
  ).rejects.toBeInstanceOf(TenantMismatchError);
});

test("a repository the tenant has lost is still the tenant's: its documents and signatures stay with it", async () => {
  const { db, t1 } = await world();
  await db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-06-01T00:00:00Z') })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  await expect(
    assertRepositoryInTenant(db, { installationId: t1.installationId }, t1.plain.repositoryId),
  ).resolves.toBeUndefined();
});

test('the error is told by its name, and its message names neither tenant nor repository', async () => {
  const { db, t1, t2 } = await world();
  const error = await assertRepositoryInTenant(db, { installationId: t1.installationId }, t2.plain.repositoryId).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({ name: 'TenantMismatchError', message: 'the repository is not in this tenant' });
});

test('the check works inside a transaction, which is where a job writes', async () => {
  const { db, t1, t2 } = await world();
  await db.transaction().execute(async (trx) => {
    await assertRepositoryInTenant(trx, { installationId: t1.installationId }, t1.plain.repositoryId);
    await expect(
      assertRepositoryInTenant(trx, { installationId: t1.installationId }, t2.plain.repositoryId),
    ).rejects.toBeInstanceOf(TenantMismatchError);
  });
});
