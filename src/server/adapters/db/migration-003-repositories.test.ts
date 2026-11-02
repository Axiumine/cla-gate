// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { expect, test } from 'vitest';
import type { Database } from './schema.ts';
import {
  asRuntimeRole,
  migratedRuntimeDatabase,
  migratedTestDatabase,
  seedSignature,
  seedTenant,
} from './test-support.ts';

// Migration 003 (E05-S06): a repository is active under at most one installation, and nothing is ever deleted.
// seedTenant(db, n) creates installation n (GitHub id n * 5000) with the repository whose GitHub id is n * 9000.

const UNIQUE = { code: '23505' };
const DENIED = { code: '42501' };

const REMOVED = new Date('2026-05-02T08:00:00Z');

function insertRepository(db: Kysely<Database>, installationId: number, githubRepoId: number, removedAt?: Date) {
  return db
    .insertInto('repositories')
    .values({
      installation_id: installationId,
      github_repo_id: githubRepoId,
      full_name: `org/repo-${githubRepoId}`,
      removed_at: removedAt ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
}

test('a new repository is not removed and not enabled', async () => {
  const { db } = await migratedTestDatabase();
  await seedTenant(db);
  const row = await db.selectFrom('repositories').select(['removed_at', 'enabled']).executeTakeFirstOrThrow();
  expect(row).toEqual({ removed_at: null, enabled: false });
});

test('the same repository cannot be active under two installations', async () => {
  const { db } = await migratedTestDatabase();
  await seedTenant(db, 1);
  const second = await seedTenant(db, 2);
  await expect(insertRepository(db, second.installationId, 9000)).rejects.toMatchObject(UNIQUE);
  const owners = await db
    .selectFrom('repositories')
    .select('installation_id')
    .where('github_repo_id', '=', 9000)
    .execute();
  expect(owners).toHaveLength(1);
});

test('a transfer inserts a row under the new installation and leaves the old tenant row as it was', async () => {
  const { db } = await migratedTestDatabase();
  const first = await seedTenant(db, 1);
  const second = await seedTenant(db, 2);
  const before = await db
    .selectFrom('repositories')
    .selectAll()
    .where('id', '=', first.repositoryId)
    .executeTakeFirstOrThrow();
  await db.updateTable('repositories').set({ removed_at: REMOVED }).where('id', '=', first.repositoryId).execute();
  const moved = await insertRepository(db, second.installationId, 9000);
  const rows = await db
    .selectFrom('repositories')
    .select(['id', 'installation_id', 'removed_at'])
    .where('github_repo_id', '=', 9000)
    .orderBy('id')
    .execute();
  expect(rows).toEqual([
    { id: first.repositoryId, installation_id: first.installationId, removed_at: REMOVED },
    { id: moved.id, installation_id: second.installationId, removed_at: null },
  ]);
  const after = await db
    .selectFrom('repositories')
    .selectAll()
    .where('id', '=', first.repositoryId)
    .executeTakeFirstOrThrow();
  expect(after).toEqual({ ...before, removed_at: REMOVED });
});

test('a removed row cannot be brought back while another installation holds the repository', async () => {
  const { db } = await migratedTestDatabase();
  const first = await seedTenant(db, 1);
  const second = await seedTenant(db, 2);
  await db.updateTable('repositories').set({ removed_at: REMOVED }).where('id', '=', first.repositoryId).execute();
  await insertRepository(db, second.installationId, 9000);
  const revive = db
    .updateTable('repositories')
    .set({ removed_at: null })
    .where('id', '=', first.repositoryId)
    .execute();
  await expect(revive).rejects.toMatchObject(UNIQUE);
});

test('removed rows of two installations can coexist, and so can one removed and one active', async () => {
  const { db } = await migratedTestDatabase();
  const first = await seedTenant(db, 1);
  const second = await seedTenant(db, 2);
  await db.updateTable('repositories').set({ removed_at: REMOVED }).execute();
  await insertRepository(db, first.installationId, 9500, REMOVED);
  await expect(insertRepository(db, second.installationId, 9500, REMOVED)).resolves.toBeTruthy();
  const stored = await db.selectFrom('repositories').select('id').where('github_repo_id', '=', 9500).execute();
  expect(stored).toHaveLength(2);
});

test('one installation stores a repository once, removed or not', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  await expect(insertRepository(db, tenant.installationId, 9000)).rejects.toMatchObject(UNIQUE);
  await db.updateTable('repositories').set({ removed_at: REMOVED }).execute();
  await expect(insertRepository(db, tenant.installationId, 9000)).rejects.toMatchObject(UNIQUE);
});

test('the uniqueness rules are the pair, the partial index and nothing global', async () => {
  const { db } = await migratedTestDatabase();
  const { rows } = await sql<{ definition: string }>`
    select indexdef as definition from pg_indexes
    where schemaname = 'public' and tablename = 'repositories' and indexdef like 'CREATE UNIQUE%'
    order by indexname`.execute(db);
  const definitions = rows.map((row) =>
    row.definition.replace(/^CREATE UNIQUE INDEX \S+ ON (public\.)?repositories USING btree /, ''),
  );
  expect(definitions.toSorted((a, b) => a.localeCompare(b))).toEqual([
    '(github_repo_id) WHERE (removed_at IS NULL)',
    '(id, installation_id)',
    '(id)',
    '(installation_id, github_repo_id)',
  ]);
});

test('the identity of a repository row still cannot change, so a transfer is a new row', async () => {
  const { db } = await migratedRuntimeDatabase();
  await seedTenant(db, 1);
  const second = await seedTenant(db, 2);
  const move = asRuntimeRole(db, (trx) =>
    trx
      .updateTable('repositories')
      .set({ installation_id: second.installationId })
      .where('github_repo_id', '=', 9000)
      .execute(),
  );
  await expect(move).rejects.toMatchObject({ code: '23001' });
});

// ------------------------------------------------------------------------------------------------ runtime role

test.each([
  ['DELETE on installations', sql`delete from installations`],
  ['DELETE on repositories', sql`delete from repositories`],
  ['TRUNCATE of installations', sql`truncate installations cascade`],
  ['TRUNCATE of repositories', sql`truncate repositories cascade`],
])('the runtime role cannot do %s: uninstalling and removing only set a timestamp', async (_operation, statement) => {
  const { db } = await migratedRuntimeDatabase();
  const tenant = await seedTenant(db);
  await seedSignature(db, tenant, 111);
  await expect(asRuntimeRole(db, (trx) => statement.execute(trx))).rejects.toMatchObject(DENIED);
  const intact = await sql<{ installations: number; repositories: number; signatures: number }>`
    select (select count(*) from installations)::int as installations, (select count(*) from repositories)::int as repositories,
           (select count(*) from signatures)::int as signatures`.execute(db);
  expect(intact.rows).toEqual([{ installations: 1, repositories: 1, signatures: 1 }]);
});

test('the runtime role can record a decision, an uninstall, a sync and a removal', async () => {
  const { db } = await migratedRuntimeDatabase();
  const tenant = await seedTenant(db);
  const when = new Date('2026-05-03T09:00:00Z');
  await asRuntimeRole(db, async (trx) => {
    await trx
      .updateTable('installations')
      .set({
        admission_status: 'admitted',
        admission_reason: null,
        admission_decided_at: when,
        last_synced_at: when,
        deleted_at: when,
      })
      .where('id', '=', tenant.installationId)
      .execute();
    await trx.updateTable('repositories').set({ removed_at: when }).where('id', '=', tenant.repositoryId).execute();
  });
  const installation = await db
    .selectFrom('installations')
    .select(['admission_status', 'admission_decided_at', 'last_synced_at', 'deleted_at'])
    .executeTakeFirstOrThrow();
  expect(installation).toEqual({
    admission_status: 'admitted',
    admission_decided_at: when,
    last_synced_at: when,
    deleted_at: when,
  });
  const repository = await db.selectFrom('repositories').select('removed_at').executeTakeFirstOrThrow();
  expect(repository).toEqual({ removed_at: when });
});
