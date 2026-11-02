// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { loadMigrationFiles } from './migration-files.ts';
import { migrate } from './migrator.ts';
import { emptyTestDatabase, MIGRATIONS_DIRECTORY, migratedTestDatabase } from './test-support.ts';

// Migration 003 (E05-S06): what an installation remembers about its admission and its lifecycle.

const CHECK = { code: '23514' };

const ACCOUNT = { account_id: 7000, account_login: 'org-1', account_type: 'Organization' } as const;

test('a row inserted without a decision is rejected, undecided, not deleted and never synced', async () => {
  const { db } = await migratedTestDatabase();
  const row = await db
    .insertInto('installations')
    .values({ github_installation_id: 5000, ...ACCOUNT })
    .returningAll()
    .executeTakeFirstOrThrow();
  expect(row).toMatchObject({
    admission_status: 'rejected',
    admission_reason: null,
    admission_decided_at: null,
    deleted_at: null,
    last_synced_at: null,
    suspended_at: null,
  });
});

test('an installation that existed before the migration becomes rejected, so it cannot be evaluated until decided', async () => {
  const { db } = await emptyTestDatabase();
  const files = await loadMigrationFiles(MIGRATIONS_DIRECTORY);
  await migrate(
    db,
    files.filter((file) => file.name < '003'),
  );
  await sql`insert into installations (github_installation_id, account_id, account_login, account_type)
    values (5000, 7000, 'org-1', 'Organization')`.execute(db);
  await migrate(db, files);
  const rows = await db.selectFrom('installations').select(['github_installation_id', 'admission_status']).execute();
  expect(rows).toEqual([{ github_installation_id: 5000, admission_status: 'rejected' }]);
});

test.each([
  ['admitted', null],
  ['rejected', null],
  ['rejected', 'account_not_allowed'],
  ['rejected', 'policy_changed'],
] as const)('the decision (%s, reason %s) is accepted', async (status, reason) => {
  const { db } = await migratedTestDatabase();
  const decidedAt = new Date('2026-05-01T10:00:00Z');
  const row = await db
    .insertInto('installations')
    .values({
      github_installation_id: 5000,
      ...ACCOUNT,
      admission_status: status,
      admission_reason: reason,
      admission_decided_at: decidedAt,
    })
    .returning(['admission_status', 'admission_reason', 'admission_decided_at'])
    .executeTakeFirstOrThrow();
  expect(row).toEqual({ admission_status: status, admission_reason: reason, admission_decided_at: decidedAt });
});

const NOT_NULL = { code: '23502' };

test.each([
  ['an unknown status', 'admission_status', 'pending', CHECK],
  ['an empty status', 'admission_status', '', CHECK],
  ['a status in another case', 'admission_status', 'Admitted', CHECK],
  ['no status', 'admission_status', null, NOT_NULL],
  ['an unknown reason', 'admission_reason', 'because', CHECK],
  ['an empty reason', 'admission_reason', '', CHECK],
])('%s is refused on insert and on update', async (_name, column, value, error) => {
  const { db } = await migratedTestDatabase();
  const seeded = await db
    .insertInto('installations')
    .values({ github_installation_id: 5000, ...ACCOUNT })
    .returning('id')
    .executeTakeFirstOrThrow();
  const insert = sql`insert into installations (github_installation_id, account_id, account_login, account_type, ${sql.ref(column)})
    values (5001, 7001, 'org-2', 'Organization', ${value})`;
  await expect(insert.execute(db)).rejects.toMatchObject(error);
  const update = sql`update installations set ${sql.ref(column)} = ${value} where id = ${seeded.id}`;
  await expect(update.execute(db)).rejects.toMatchObject(error);
  const rows = await db.selectFrom('installations').select(['id', 'admission_status', 'admission_reason']).execute();
  expect(rows).toEqual([{ id: seeded.id, admission_status: 'rejected', admission_reason: null }]);
});

test('the existing constraints of installations still hold next to the new ones', async () => {
  const { db } = await migratedTestDatabase();
  await db
    .insertInto('installations')
    .values({ github_installation_id: 5000, ...ACCOUNT })
    .execute();
  const duplicate = db
    .insertInto('installations')
    .values({ github_installation_id: 5000, ...ACCOUNT })
    .execute();
  await expect(duplicate).rejects.toMatchObject({ code: '23505' });
  const badType = sql`insert into installations (github_installation_id, account_id, account_login, account_type)
    values (5002, 7002, 'x', 'Bot')`.execute(db);
  await expect(badType).rejects.toMatchObject(CHECK);
});
