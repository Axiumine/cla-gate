// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { listAccount, sharedSigner, snapshots } from './erasure-fixture/test-support.ts';
import { MIGRATIONS_DIRECTORY, migratedRuntimeDatabase, migratedTestDatabase, seedTenant } from './test-support.ts';

// Migration 013 (E14-S06): `erase_signer_pii` reaches the login snapshot of an allowlisted account that never signed and has no
// `users` row, and still refuses a person the installation knows nothing of.

const NEVER_SIGNED = 555;
const ACTOR = 9999;
const NO_USER = { code: 'P0002', message: 'erase_signer_pii: no user with that GitHub id' };

const audit = (db: Awaited<ReturnType<typeof migratedTestDatabase>>['db']) =>
  db
    .selectFrom('audit_log')
    .select(['installation_id', 'actor_github_id', 'action', 'subject_type', 'subject_id', 'metadata'])
    .execute();

test('an allowlisted account with no user row is erased: its snapshot is cleared in that installation only, and one audit row says so', async () => {
  const { db } = await migratedTestDatabase();
  const t1 = await seedTenant(db, 1);
  const t2 = await seedTenant(db, 2);
  await listAccount(db, t1, NEVER_SIGNED, 'ada');
  await listAccount(db, t1, 222, 'grace');
  await listAccount(db, t2, NEVER_SIGNED, 'ada');

  const erased = await sql<{
    n: number;
  }>`select erase_signer_pii(${NEVER_SIGNED}, ${ACTOR}, ${t1.installationId}) as n`.execute(db);

  expect(erased.rows).toEqual([{ n: 0 }]);
  expect(await snapshots(db)).toEqual([
    { installation_id: t1.installationId, github_id: 222, login_snapshot: 'grace' },
    { installation_id: t1.installationId, github_id: NEVER_SIGNED, login_snapshot: null },
    { installation_id: t2.installationId, github_id: NEVER_SIGNED, login_snapshot: 'ada' },
  ]);
  expect(await audit(db)).toEqual([
    {
      installation_id: t1.installationId,
      actor_github_id: ACTOR,
      action: 'signer_pii.erased',
      subject_type: 'user',
      subject_id: NEVER_SIGNED,
      metadata: { signer_pii_rows: 0 },
    },
  ]);
  expect(await db.selectFrom('users').select('id').where('github_id', '=', NEVER_SIGNED).execute()).toEqual([]);
});

test('a person no user row and no entry of this installation knows is refused, even when another installation lists them, and nothing changes', async () => {
  const { db } = await migratedTestDatabase();
  const t1 = await seedTenant(db, 1);
  const t2 = await seedTenant(db, 2);
  await listAccount(db, t2, NEVER_SIGNED, 'ada');

  await expect(
    sql`select erase_signer_pii(${NEVER_SIGNED}, ${ACTOR}, ${t1.installationId})`.execute(db),
  ).rejects.toMatchObject(NO_USER);

  expect(await snapshots(db)).toEqual([
    { installation_id: t2.installationId, github_id: NEVER_SIGNED, login_snapshot: 'ada' },
  ]);
  expect(await audit(db)).toEqual([]);
});

test('a person with a user row who signed in another installation only is erased here by the clearing of their snapshot, and keeps their data there', async () => {
  const { db } = await migratedTestDatabase();
  await sharedSigner(db, 111);
  const t3 = await seedTenant(db, 3);
  await listAccount(db, t3, 111, 'ada');
  const personalData = () => sql`select user_id, signature_id from signer_pii order by signature_id`.execute(db);
  const before = (await personalData()).rows;

  const erased = await sql<{ n: number }>`select erase_signer_pii(${111}, ${ACTOR}, ${t3.installationId}) as n`.execute(
    db,
  );

  expect(erased.rows).toEqual([{ n: 0 }]);
  expect(await snapshots(db)).toEqual([{ installation_id: t3.installationId, github_id: 111, login_snapshot: null }]);
  expect((await personalData()).rows).toEqual(before);
  expect(await db.selectFrom('users').select('login').where('github_id', '=', 111).execute()).toEqual([
    { login: 'login-111' },
  ]);
});

test('the runtime role runs the redefined function for an allowlisted account, as it ran the earlier one', async () => {
  const { db } = await migratedRuntimeDatabase();
  const tenant = await seedTenant(db, 1);
  await listAccount(db, tenant, NEVER_SIGNED, 'ada');
  const erased = await sql<{ n: number }>`
    select erase_signer_pii(${NEVER_SIGNED}, ${ACTOR}, ${tenant.installationId}) as n`.execute(db);
  expect(erased.rows).toEqual([{ n: 0 }]);
  expect(await snapshots(db)).toEqual([
    { installation_id: tenant.installationId, github_id: NEVER_SIGNED, login_snapshot: null },
  ]);
});

test('the file redefines the one function and touches no table, trigger or grant', () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: a migration file of this repository's own folder
  const text = fs.readFileSync(path.join(MIGRATIONS_DIRECTORY, '013_erase_allowlist_only_person.sql'), 'utf8');
  const statements = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  expect(statements.match(/create or replace function\s+(\w+)\(/gi)).toEqual([
    'create or replace function erase_signer_pii(',
  ]);
  expect(statements).not.toMatch(/\b(?:drop|alter|grant|revoke|trigger)\b/i);
});

test('the migration is recorded under its own number, on top of the earlier ones', async () => {
  const { db } = await migratedTestDatabase();
  const { rows } = await sql<{ name: string }>`select name from schema_migrations where name like '013%'`.execute(db);
  expect(rows).toEqual([{ name: '013_erase_allowlist_only_person.sql' }]);
});
