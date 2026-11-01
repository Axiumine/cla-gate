// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, onTestFinished, test } from 'vitest';
import { loadMigrationFiles } from './migration-files.ts';
import { migrate } from './migrator.ts';
import { openPgliteDatabase } from './pglite.ts';
import {
  asRuntimeRole,
  MIGRATIONS_DIRECTORY,
  migratedRuntimeDatabase,
  seedSignature,
  seedTenant,
} from './test-support.ts';

// The role model: the connecting (owner) role owns the tables, cla_app does not and gets minimal grants. PGlite
// enforces privileges for a role switched to with SET ROLE just like Postgres does, so this runs on both.

const DENIED = { code: '42501' };

async function withRuntimeRole() {
  const { db } = await migratedRuntimeDatabase();
  const tenant = await seedTenant(db);
  const signer = await seedSignature(db, tenant, 111);
  return { db, tenant, signer };
}

test('cla_app owns no table, no function and not the schema', async () => {
  const { db } = await withRuntimeRole();
  const { rows } = await sql<{ owners: number; appOwns: boolean }>`
    select count(distinct tableowner)::int as owners, coalesce(bool_or(tableowner = 'cla_app'), false) as "appOwns"
    from pg_tables where schemaname = 'public'`.execute(db);
  expect(rows).toEqual([{ owners: 1, appOwns: false }]);
  const functions = await sql<{ owner: string }>`
    select pg_get_userbyid(proowner) as owner from pg_proc
    where pronamespace = 'public'::regnamespace and proname in ('erase_signer_pii', 'forbid_modification', 'signatures_guard_update')`.execute(
    db,
  );
  expect(functions.rows).toHaveLength(3);
  expect(functions.rows.map((row) => row.owner)).not.toContain('cla_app');
});

test('the runtime role can do its daily work', async () => {
  const { db, tenant } = await withRuntimeRole();
  await asRuntimeRole(db, async (trx) => {
    await trx.insertInto('users').values({ github_id: 333, login: 'new-user', name: null, avatar_url: null }).execute();
    await trx.insertInto('audit_log').values({ action: 'cla.signed', actor_github_id: 333 }).execute();
    await trx.insertInto('webhook_deliveries').values({ delivery_id: 'd-1', event: 'ping', action: null }).execute();
    await trx.deleteFrom('webhook_deliveries').execute();
    const signatures = await trx.selectFrom('signatures').select('id').execute();
    expect(signatures).toHaveLength(1);
  });
  const revoked = await asRuntimeRole(db, (trx) =>
    trx
      .updateTable('signatures')
      .set({ revoked_at: new Date(), revoked_by: tenant.publisherId, revoke_reason: 'signer_request' })
      .returning('id')
      .execute(),
  );
  expect(revoked).toHaveLength(1);
});

test.each([
  ['DELETE on signer_pii', sql`delete from signer_pii`],
  ['UPDATE on signer_pii', sql`update signer_pii set name = 'x'`],
  ['TRUNCATE of signer_pii', sql`truncate signer_pii`],
  ['DELETE on signatures', sql`delete from signatures`],
  ['UPDATE of the signature core', sql`update signatures set consent_text_id = 'x'`],
  ['UPDATE on audit_log', sql`update audit_log set action = 'x.y'`],
  ['DELETE on audit_log', sql`delete from audit_log`],
  ['DELETE on cla_versions', sql`delete from cla_versions`],
  ['UPDATE on cla_versions', sql`update cla_versions set rationale = 'x'`],
  ['reading schema_migrations', sql`select * from schema_migrations`],
  ['disabling a trigger', sql`alter table signer_pii disable trigger all`],
  ['dropping a trigger', sql`drop trigger audit_log_immutable on audit_log`],
  ['creating a table', sql`create table not_allowed (id integer)`],
])('the runtime role cannot do %s', async (_operation, statement) => {
  const { db } = await withRuntimeRole();
  await expect(asRuntimeRole(db, (trx) => statement.execute(trx))).rejects.toMatchObject(DENIED);
  const intact = await sql<{ n: number }>`select count(*)::int as n from signer_pii`.execute(db);
  expect(intact.rows).toEqual([{ n: 1 }]);
});

test('the runtime role erases personal data only through erase_signer_pii', async () => {
  const { db } = await withRuntimeRole();
  const erased = await asRuntimeRole(db, (trx) =>
    sql<{ n: number }>`select erase_signer_pii(111, 9999) as n`.execute(trx),
  );
  expect(erased.rows).toEqual([{ n: 1 }]);
  expect(await db.selectFrom('signer_pii').select('signature_id').execute()).toEqual([]);
  expect(await db.selectFrom('audit_log').select('action').execute()).toEqual([{ action: 'signer_pii.erased' }]);
  expect(await db.selectFrom('signatures').select('id').execute()).toHaveLength(1);
});

test('migrating without the runtime role present skips the grants and still succeeds', async () => {
  const db = await openPgliteDatabase();
  onTestFinished(async () => {
    await db.destroy();
  });
  const role = await sql`select 1 from pg_roles where rolname = 'cla_app'`.execute(db);
  expect(role.rows).toEqual([]);
  expect(await migrate(db, await loadMigrationFiles(MIGRATIONS_DIRECTORY))).toEqual(['001_initial.sql']);
});
