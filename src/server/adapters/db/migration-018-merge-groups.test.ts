// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { twoTenants } from './tenant-fixture/test-support.ts';
import { asRuntimeRole, migratedRuntimeDatabase, migratedTestDatabase, seedTenant } from './test-support.ts';

// Migration 018 (E22-S01): the evaluation of a merge queue's group. One row per head SHA of a repository, tied to its tenant by a
// composite foreign key, never deleted by the runtime role, and nothing of migration 001 weakened.

const CHECK = { code: '23514' };
const FOREIGN_KEY = { code: '23503' };
const UNIQUE = { code: '23505' };
const DENIED = { code: '42501' };
const HEAD = '9'.repeat(40);
const BASE = '8'.repeat(40);
/** A head SHA the two-tenant fixture does not use. */
const SHARED = 'c'.repeat(40);
const RESTRICT = { code: '23001' };

async function seeded() {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db, 1);
  const row = {
    installation_id: tenant.installationId,
    repository_id: tenant.repositoryId,
    head_sha: HEAD,
    base_sha: BASE,
  };
  return { db, tenant, row };
}

test('the table holds the ids, the two SHAs, the result, the details, the Check Run, the destruction and the times, and nothing else', async () => {
  const { db } = await migratedTestDatabase();
  const { rows } = await sql<{
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>`
    select column_name, data_type, is_nullable, column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'merge_group_evaluations' order by ordinal_position`.execute(db);
  expect(rows.map((row) => [row.column_name, row.data_type, row.is_nullable])).toEqual([
    ['id', 'bigint', 'NO'],
    ['installation_id', 'bigint', 'NO'],
    ['repository_id', 'bigint', 'NO'],
    ['head_sha', 'text', 'NO'],
    ['base_sha', 'text', 'NO'],
    ['result', 'text', 'NO'],
    ['details', 'jsonb', 'NO'],
    ['check_run_id', 'bigint', 'YES'],
    ['destroyed_at', 'timestamp with time zone', 'YES'],
    ['created_at', 'timestamp with time zone', 'NO'],
    ['updated_at', 'timestamp with time zone', 'NO'],
  ]);
  expect(rows.find((row) => row.column_name === 'result')?.column_default).toContain('in_progress');
  expect(rows.find((row) => row.column_name === 'details')?.column_default).toContain('{}');
});

test('a new row is in progress with empty details, no Check Run and not destroyed', async () => {
  const { db, row } = await seeded();
  const stored = await db.insertInto('merge_group_evaluations').values(row).returningAll().executeTakeFirstOrThrow();
  expect(stored).toMatchObject({ result: 'in_progress', details: {}, check_run_id: null, destroyed_at: null });
  expect(Math.abs(stored.created_at.getTime() - Date.now())).toBeLessThan(60_000);
});

test('the pair repository and head SHA is unique: a second row for one group is refused, the same SHA in another repository is not', async () => {
  const { db, tenant, row } = await seeded();
  await db.insertInto('merge_group_evaluations').values(row).execute();
  await expect(db.insertInto('merge_group_evaluations').values(row).execute()).rejects.toMatchObject(UNIQUE);
  const other = await db
    .insertInto('repositories')
    .values({
      installation_id: tenant.installationId,
      github_repo_id: 9001,
      full_name: 'org-1/other',
      cla_document_id: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('merge_group_evaluations')
    .values({ ...row, repository_id: other.id })
    .execute();
  expect(await db.selectFrom('merge_group_evaluations').select('id').execute()).toHaveLength(2);
});

test.each([['maybe'], ['Success'], ['cancelled'], ['']])(
  'the result %j is refused: only in progress, success and failure exist',
  async (result) => {
    const { db, row } = await seeded();
    await expect(
      sql`insert into merge_group_evaluations (installation_id, repository_id, head_sha, base_sha, result)
    values (${row.installation_id}, ${row.repository_id}, ${HEAD}, ${BASE}, ${result})`.execute(db),
    ).rejects.toMatchObject(CHECK);
  },
);

test.each([['in_progress'], ['success'], ['failure']])('the result %s is stored', async (result) => {
  const { db, row } = await seeded();
  const stored = await sql<{
    result: string;
  }>`insert into merge_group_evaluations (installation_id, repository_id, head_sha, base_sha, result)
    values (${row.installation_id}, ${row.repository_id}, ${HEAD}, ${BASE}, ${result}) returning result`.execute(db);
  expect(stored.rows).toEqual([{ result }]);
});

test.each([
  ['a head SHA in capitals', { head_sha: 'A'.repeat(40) }],
  ['a head SHA of 39 digits', { head_sha: '9'.repeat(39) }],
  ['a head SHA of 41 digits', { head_sha: '9'.repeat(41) }],
  ['a head SHA that is not hexadecimal', { head_sha: 'g'.repeat(40) }],
  ['a base SHA of 12 digits', { base_sha: '8'.repeat(12) }],
  ['a Check Run id of zero', { check_run_id: 0 }],
  ['a Check Run id below zero', { check_run_id: -1 }],
])('%s is refused by the database', async (_name, change) => {
  const { db, row } = await seeded();
  await expect(
    db
      .insertInto('merge_group_evaluations')
      .values({ ...row, ...change })
      .execute(),
  ).rejects.toMatchObject(CHECK);
});

test('a SHA of 64 digits, which a SHA-256 repository has, is stored', async () => {
  const { db, row } = await seeded();
  await db
    .insertInto('merge_group_evaluations')
    .values({ ...row, head_sha: '9'.repeat(64), base_sha: '8'.repeat(64) })
    .execute();
  expect(await db.selectFrom('merge_group_evaluations').select('head_sha').execute()).toEqual([
    { head_sha: '9'.repeat(64) },
  ]);
});

test.each([['[]'], ['"text"'], ['7'], ['null']])(
  'details that are %s and not an object are refused',
  async (details) => {
    const { db, row } = await seeded();
    await expect(
      sql`insert into merge_group_evaluations (installation_id, repository_id, head_sha, base_sha, details)
    values (${row.installation_id}, ${row.repository_id}, ${HEAD}, ${BASE}, ${details}::jsonb)`.execute(db),
    ).rejects.toThrow();
  },
);

test("a raw insert that pairs tenant 1's repository with tenant 2's installation id is refused by the composite foreign key, and so is the move of a row", async () => {
  const { db } = await migratedTestDatabase();
  const { t1, t2 } = await twoTenants(db);
  const attempt = db
    .insertInto('merge_group_evaluations')
    .values({
      installation_id: t2.installationId,
      repository_id: t1.plain.repositoryId,
      head_sha: 'a'.repeat(40),
      base_sha: BASE,
    })
    .execute();
  await expect(attempt).rejects.toMatchObject(FOREIGN_KEY);
  const moved = db
    .updateTable('merge_group_evaluations')
    .set({ installation_id: t2.installationId })
    .where('repository_id', '=', t1.plain.repositoryId)
    .execute();
  await expect(moved).rejects.toMatchObject(FOREIGN_KEY);
  const rows = await db
    .selectFrom('merge_group_evaluations')
    .select(['repository_id', 'installation_id'])
    .orderBy('id')
    .execute();
  expect(rows).toEqual([
    { repository_id: t1.plain.repositoryId, installation_id: t1.installationId },
    { repository_id: t2.plain.repositoryId, installation_id: t2.installationId },
  ]);
});

test('the same head SHA in the repositories of two tenants is two rows, each of its own tenant', async () => {
  const { db } = await migratedTestDatabase();
  const { t1, t2 } = await twoTenants(db);
  await db
    .insertInto('merge_group_evaluations')
    .values([
      { installation_id: t1.installationId, repository_id: t1.scoped.repositoryId, head_sha: SHARED, base_sha: BASE },
      { installation_id: t2.installationId, repository_id: t2.scoped.repositoryId, head_sha: SHARED, base_sha: BASE },
    ])
    .execute();
  const rows = await db
    .selectFrom('merge_group_evaluations')
    .select('installation_id')
    .where('head_sha', '=', SHARED)
    .execute();
  expect(rows.map((row) => row.installation_id).toSorted((a, b) => a - b)).toEqual([
    t1.installationId,
    t2.installationId,
  ]);
});

test('a repository that a row points at cannot be deleted from under it', async () => {
  const { db, row } = await seeded();
  await db.insertInto('merge_group_evaluations').values(row).execute();
  await expect(sql`delete from repositories where id = ${row.repository_id}`.execute(db)).rejects.toMatchObject(
    RESTRICT,
  );
});

test('the runtime role reads, creates and updates the rows of a group, and cannot delete one or truncate the table', async () => {
  const { db } = await migratedRuntimeDatabase();
  const tenant = await seedTenant(db, 1);
  const row = {
    installation_id: tenant.installationId,
    repository_id: tenant.repositoryId,
    head_sha: HEAD,
    base_sha: BASE,
  };
  await asRuntimeRole(db, async (trx) => {
    await trx.insertInto('merge_group_evaluations').values(row).execute();
    await trx
      .updateTable('merge_group_evaluations')
      .set({ result: 'success', check_run_id: 5 })
      .where('head_sha', '=', HEAD)
      .execute();
    expect(await trx.selectFrom('merge_group_evaluations').select('result').execute()).toEqual([{ result: 'success' }]);
  });
  await expect(asRuntimeRole(db, (trx) => sql`delete from merge_group_evaluations`.execute(trx))).rejects.toMatchObject(
    DENIED,
  );
  await expect(asRuntimeRole(db, (trx) => sql`truncate merge_group_evaluations`.execute(trx))).rejects.toMatchObject(
    DENIED,
  );
  expect(await db.selectFrom('merge_group_evaluations').select('id').execute()).toHaveLength(1);
});

test('the grant names the runtime role and no one else: PUBLIC holds nothing on the table', async () => {
  const { db } = await migratedRuntimeDatabase();
  const { rows } = await sql<{ app_select: boolean; app_delete: boolean; anyone: boolean }>`
    select has_table_privilege('cla_app', 'merge_group_evaluations', 'select') as app_select,
           has_table_privilege('cla_app', 'merge_group_evaluations', 'delete') as app_delete,
           has_table_privilege('public', 'merge_group_evaluations', 'select') as anyone`.execute(db);
  expect(rows).toEqual([{ app_select: true, app_delete: false, anyone: false }]);
});
