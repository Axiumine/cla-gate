// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { type Kysely, sql } from 'kysely';
import { expect, test } from 'vitest';
import { sharedSigner } from './erasure-fixture/test-support.ts';
import { addNetworkColumns, CUTOFF, setNetwork, shifted } from './network-metadata-fixture/test-support.ts';
import type { Database } from './schema.ts';
import {
  asRuntimeRole,
  MIGRATIONS_DIRECTORY,
  migratedRuntimeDatabase,
  migratedTestDatabase,
  seedTenant,
  type Tenant,
} from './test-support.ts';

// Migration 012 (E14-S06): `allowlist_entries.login_snapshot`, the login an entry was made under, kept to be shown. The column
// is a display snapshot: the database refuses anything but the shape of a GitHub login, the erasure of the person clears it, the
// purge of the network metadata leaves it, and nothing of migration 001 is weakened.

const CHECK = { code: '23514' };

const CHANGED = 'zzzz-changed';
const SIGNER = 111;

/** An entry of `tenant` for the account `githubId`, with `snapshot` as login. */
function entryFor(db: Kysely<Database>, tenant: Tenant, githubId: number, snapshot: string | null) {
  return db
    .insertInto('allowlist_entries')
    .values({
      installation_id: tenant.installationId,
      kind: 'user',
      github_id: githubId,
      created_by: tenant.publisherId,
      login_snapshot: snapshot,
    })
    .execute();
}

const snapshotsOf = async (db: Kysely<Database>) =>
  db
    .selectFrom('allowlist_entries')
    .select(['installation_id', 'github_id', 'login_snapshot'])
    .orderBy('installation_id')
    .orderBy('github_id')
    .execute();

test('the column is nullable text with no default, and the first entry of the table has no login', async () => {
  const { db } = await migratedTestDatabase();
  const { rows } = await sql<{ data_type: string; is_nullable: string; column_default: string | null }>`
    select data_type, is_nullable, column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'allowlist_entries' and column_name = 'login_snapshot'`.execute(db);
  expect(rows).toEqual([{ data_type: 'text', is_nullable: 'YES', column_default: null }]);
  const tenant = await seedTenant(db);
  await db
    .insertInto('allowlist_entries')
    .values({ installation_id: tenant.installationId, kind: 'user', github_id: 100, created_by: tenant.publisherId })
    .execute();
  expect(await snapshotsOf(db)).toEqual([
    { installation_id: tenant.installationId, github_id: 100, login_snapshot: null },
  ]);
});

test.each([['a-name'], ['Octo-Cat'], ['9lives'], ['a'], ['a'.repeat(39)], ['dependabot[bot]'], ['renovate-bot[bot]']])(
  'the database accepts the login %s',
  async (login) => {
    const { db } = await migratedTestDatabase();
    const tenant = await seedTenant(db);
    await entryFor(db, tenant, 100, login);
    expect((await snapshotsOf(db)).map((row) => row.login_snapshot)).toEqual([login]);
  },
);

test.each([
  [''],
  ['-leading'],
  ['has space'],
  ['<b>zzzz</b>'],
  ['a'.repeat(40)],
  ['a_b'],
  ['name\n'],
  ['name[bot]x'],
  ['name[bot][bot]'],
  ['[bot]'],
  ['naïve'],
])('the database refuses the login %j, and the row is not made', async (login) => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  await expect(entryFor(db, tenant, 100, login)).rejects.toMatchObject(CHECK);
  expect(await snapshotsOf(db)).toEqual([]);
});

test('the erasure of a person clears the login of their entries in that installation, keeps the rows and their ids, and touches no other', async () => {
  const { db } = await migratedTestDatabase();
  const { t1, t2 } = await sharedSigner(db, SIGNER);
  await entryFor(db, t1, SIGNER, 'ada');
  await entryFor(db, t1, 222, 'grace');
  await entryFor(db, t2, SIGNER, 'ada');

  await sql`select erase_signer_pii(${SIGNER}, ${9999}, ${t1.installationId})`.execute(db);

  expect(await snapshotsOf(db)).toEqual([
    { installation_id: t1.installationId, github_id: SIGNER, login_snapshot: null },
    { installation_id: t1.installationId, github_id: 222, login_snapshot: 'grace' },
    { installation_id: t2.installationId, github_id: SIGNER, login_snapshot: 'ada' },
  ]);
});

test('the purge of the network metadata leaves the login of every entry: it is not network metadata', async () => {
  const { db } = await migratedTestDatabase();
  const { t1, t2, firstSignatureId } = await sharedSigner(db, SIGNER);
  await addNetworkColumns(db);
  await setNetwork(db, firstSignatureId, shifted(CUTOFF, -1), { ip: '203.0.113.7', userAgent: 'TestAgent/1.0' });
  await entryFor(db, t1, SIGNER, 'ada');
  await entryFor(db, t2, SIGNER, 'ada');
  await entryFor(db, t2, 222, null);

  const purged = await sql<{ n: number }>`select purge_signer_network_metadata(${CUTOFF}::timestamptz) as n`.execute(
    db,
  );

  expect(purged.rows).toEqual([{ n: 1 }]);
  expect(await snapshotsOf(db)).toEqual([
    { installation_id: t1.installationId, github_id: SIGNER, login_snapshot: 'ada' },
    { installation_id: t2.installationId, github_id: SIGNER, login_snapshot: 'ada' },
    { installation_id: t2.installationId, github_id: 222, login_snapshot: null },
  ]);
});

test('the same account keeps its login in both tenants independently: the id is the key and the login is only shown', async () => {
  const { db } = await migratedTestDatabase();
  const t1 = await seedTenant(db, 1);
  const t2 = await seedTenant(db, 2);
  await entryFor(db, t1, 4711, 'old-name');
  await entryFor(db, t2, 4711, 'new-name');
  await db
    .updateTable('allowlist_entries')
    .set({ login_snapshot: 'renamed' })
    .where('installation_id', '=', t1.installationId)
    .execute();
  expect(await snapshotsOf(db)).toEqual([
    { installation_id: t1.installationId, github_id: 4711, login_snapshot: 'renamed' },
    { installation_id: t2.installationId, github_id: 4711, login_snapshot: 'new-name' },
  ]);
});

test('the runtime role makes, reads, changes and deletes an entry with a login, as before, and the check holds for it too', async () => {
  const { db } = await migratedRuntimeDatabase();
  const tenant = await seedTenant(db);
  await asRuntimeRole(db, async (trx) => {
    await entryFor(trx, tenant, 100, 'ada');
    await trx.updateTable('allowlist_entries').set({ login_snapshot: CHANGED }).where('github_id', '=', 100).execute();
    expect(await snapshotsOf(trx)).toEqual([
      { installation_id: tenant.installationId, github_id: 100, login_snapshot: CHANGED },
    ]);
    await trx.deleteFrom('allowlist_entries').where('github_id', '=', 100).execute();
    expect(await snapshotsOf(trx)).toEqual([]);
  });
  await expect(asRuntimeRole(db, (trx) => entryFor(trx, tenant, 101, '<script>'))).rejects.toMatchObject(CHECK);
});

test('the file adds the one column and the one check, and touches no trigger, function or grant', () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: a migration file of this repository's own folder
  const text = fs.readFileSync(path.join(MIGRATIONS_DIRECTORY, '012_allowlist_login_snapshot.sql'), 'utf8');
  const statements = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  expect(statements.match(/add column\s+(\w+)/gi)).toEqual(['add column login_snapshot']);
  expect(statements.match(/add constraint\s+(\w+)/gi)).toEqual([
    'add constraint allowlist_entries_login_snapshot_shape',
  ]);
  expect(statements).not.toMatch(/\b(?:drop|trigger|function|grant|revoke|create)\b/i);
});

test('the migration is recorded under its own number, on top of the earlier ones', async () => {
  const { db } = await migratedTestDatabase();
  const { rows } = await sql<{ name: string }>`select name from schema_migrations where name like '012%'`.execute(db);
  expect(rows).toEqual([{ name: '012_allowlist_login_snapshot.sql' }]);
});
