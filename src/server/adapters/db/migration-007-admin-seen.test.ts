// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { asRuntimeRole, migratedRuntimeDatabase, migratedTestDatabase, seedTenant } from './test-support.ts';

// Migration 007 (E11-S07): the ledger of the org admins a live lookup last saw, which lets an admin read the evidence of a
// tenant whose installation GitHub has suspended or removed. Numeric ids and a time only.

const CHECK = { code: '23514' };
const FOREIGN_KEY = { code: '23503' };
const UNIQUE = { code: '23505' };
const DENIED = { code: '42501' };

const SEEN = new Date('2026-11-02T10:00:00.000Z');

const RESTRICTED = z.object({ code: z.enum(['23001', '23503']) });

test('the table holds the installation, the numeric id of the person and the time, and no login or name', async () => {
  const { db } = await migratedTestDatabase();
  const { rows } = await sql<{ column_name: string; data_type: string; is_nullable: string }>`
    select column_name, data_type, is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'installation_admin_seen' order by ordinal_position`.execute(db);
  expect(rows).toEqual([
    { column_name: 'installation_id', data_type: 'bigint', is_nullable: 'NO' },
    { column_name: 'user_github_id', data_type: 'bigint', is_nullable: 'NO' },
    { column_name: 'seen_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
  ]);
});

test('the primary key is the pair (installation, person): a person is listed once per tenant', async () => {
  const { db } = await migratedTestDatabase();
  const { rows } = await sql<{ attname: string }>`
    select a.attname from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'installation_admin_seen'::regclass and i.indisprimary
    order by array_position(i.indkey::int2[], a.attnum)`.execute(db);
  expect(rows.map((row) => row.attname)).toEqual(['installation_id', 'user_github_id']);
  const tenant = await seedTenant(db);
  const entry = { installation_id: tenant.installationId, user_github_id: 41_898_282, seen_at: SEEN };
  await db.insertInto('installation_admin_seen').values(entry).execute();
  await expect(db.insertInto('installation_admin_seen').values(entry).execute()).rejects.toMatchObject(UNIQUE);
  const other = await seedTenant(db, 2);
  await db
    .insertInto('installation_admin_seen')
    .values({ ...entry, installation_id: other.installationId })
    .execute();
  expect(await db.selectFrom('installation_admin_seen').select('user_github_id').execute()).toHaveLength(2);
});

test.each([[0], [-1]])('the person %i is not a GitHub id and is refused by the database', async (person) => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  await expect(
    db
      .insertInto('installation_admin_seen')
      .values({ installation_id: tenant.installationId, user_github_id: person, seen_at: SEEN })
      .execute(),
  ).rejects.toMatchObject(CHECK);
});

test('the entry belongs to an installation that exists, and the installation cannot be deleted from under it', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  await expect(
    sql`insert into installation_admin_seen (installation_id, user_github_id, seen_at) values (987654, 1, ${SEEN})`.execute(
      db,
    ),
  ).rejects.toMatchObject(FOREIGN_KEY);
  await sql`insert into installation_admin_seen (installation_id, user_github_id, seen_at) values (${tenant.installationId}, 1, ${SEEN})`.execute(
    db,
  );
  // Engines name a foreign key that restricts a delete differently (restrict_violation or foreign_key_violation), so the
  // code is held to either; the entry surviving is what matters.
  const removal = await sql`delete from installations where id = ${tenant.installationId}`.execute(db).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(RESTRICTED.safeParse(removal).success).toBe(true);
  const kept =
    await sql`select 1 from installation_admin_seen where installation_id = ${tenant.installationId}`.execute(db);
  expect(kept.rows).toHaveLength(1);
});

test('the runtime role reads, inserts, refreshes and deletes entries, and may do nothing else with the table', async () => {
  const { db } = await migratedRuntimeDatabase();
  const tenant = await seedTenant(db);
  const grants = await sql<{ privilege_type: string }>`
    select privilege_type from information_schema.role_table_grants
    where grantee = 'cla_app' and table_name = 'installation_admin_seen' order by privilege_type`.execute(db);
  expect(grants.rows.map((row) => row.privilege_type)).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
  await asRuntimeRole(db, async (trx) => {
    const entry = { installation_id: tenant.installationId, user_github_id: 41_898_282 };
    await trx
      .insertInto('installation_admin_seen')
      .values({ ...entry, seen_at: SEEN })
      .execute();
    await trx
      .updateTable('installation_admin_seen')
      .set({ seen_at: new Date('2026-11-02T10:01:00.000Z') })
      .where('installation_id', '=', tenant.installationId)
      .execute();
    expect(await trx.selectFrom('installation_admin_seen').select('seen_at').execute()).toEqual([
      { seen_at: new Date('2026-11-02T10:01:00.000Z') },
    ]);
    await trx.deleteFrom('installation_admin_seen').where('installation_id', '=', tenant.installationId).execute();
    expect(await trx.selectFrom('installation_admin_seen').select('seen_at').execute()).toEqual([]);
  });
  await expect(asRuntimeRole(db, (trx) => sql`truncate installation_admin_seen`.execute(trx))).rejects.toMatchObject(
    DENIED,
  );
});

test('the migration is recorded under its own number, on top of the earlier ones', async () => {
  const { db } = await migratedTestDatabase();
  const { rows } = await sql<{ name: string }>`select name from schema_migrations where name like '007%'`.execute(db);
  expect(rows).toEqual([{ name: '007_installation_admin_seen.sql' }]);
});
