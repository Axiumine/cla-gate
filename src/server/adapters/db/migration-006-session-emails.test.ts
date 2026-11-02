// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { loadMigrationFiles } from './migration-files.ts';
import { migrate } from './migrator.ts';
import { emptyTestDatabase, MIGRATIONS_DIRECTORY, migratedTestDatabase } from './test-support.ts';

// Migration 006 (E10-S01): sessions.verified_emails, the addresses a person had at login, kept as long as the session.

const CHECK = { code: '23514' };
const NOT_NULL = { code: '23502' };

const emails = (count: number) =>
  JSON.stringify(Array.from({ length: count }, (_, i) => ({ email: `a${i}@x.test`, primary: i === 0 })));

async function insertSession(verified: string | null | undefined) {
  const { db } = await migratedTestDatabase();
  await sql`insert into users (github_id, login) values (1001, 'login-1001')`.execute(db);
  const column = verified === undefined ? sql`` : sql`, verified_emails`;
  const value = verified === undefined ? sql`` : sql`, ${verified}::jsonb`;
  return sql<{ verified_emails: unknown }>`
    insert into sessions (session_hash, user_id, csrf_secret, idle_expires_at, absolute_expires_at ${column})
    select repeat('a', 64), id, 'csrf', now() + interval '1 hour', now() + interval '2 hours' ${value} from users
    returning verified_emails`.execute(db);
}

test('the column is jsonb, not null, and holds an empty array unless told otherwise', async () => {
  const { db } = await migratedTestDatabase();
  const { rows } = await sql<{ data_type: string; is_nullable: string; column_default: string }>`
    select data_type, is_nullable, column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'sessions' and column_name = 'verified_emails'`.execute(db);
  expect(rows).toEqual([{ data_type: 'jsonb', is_nullable: 'NO', column_default: "'[]'::jsonb" }]);
  expect((await insertSession(undefined)).rows).toEqual([{ verified_emails: [] }]);
});

test.each([[0], [1], [19], [20]])('an array of %i elements is accepted', async (count) => {
  const { rows } = await insertSession(emails(count));
  expect(rows[0]?.verified_emails).toHaveLength(count);
});

test.each([[21], [100]])('an array of %i elements is refused by the database', async (count) => {
  await expect(insertSession(emails(count))).rejects.toMatchObject(CHECK);
});

test.each([
  ['an object', '{"email":"a@x.test","primary":true}'],
  ['a string', '"a@x.test"'],
  ['a number', '1'],
  ['a boolean', 'true'],
  ['a JSON null', 'null'],
])('%s is not an array and is refused by the database', async (_label, value) => {
  await expect(insertSession(value)).rejects.toMatchObject(CHECK);
});

test('an SQL null is refused', async () => {
  await expect(insertSession(null)).rejects.toMatchObject(NOT_NULL);
});

test('a session that existed before the migration holds an empty list afterwards', async () => {
  const { db } = await emptyTestDatabase();
  const files = await loadMigrationFiles(MIGRATIONS_DIRECTORY);
  await migrate(
    db,
    files.filter((file) => file.name < '006'),
  );
  await sql`insert into users (github_id, login) values (1001, 'login-1001')`.execute(db);
  await sql`insert into sessions (session_hash, user_id, csrf_secret, idle_expires_at, absolute_expires_at)
    select repeat('b', 64), id, 'csrf', now() + interval '1 hour', now() + interval '2 hours' from users`.execute(db);
  await migrate(db, files);
  const { rows } = await sql`select verified_emails from sessions`.execute(db);
  expect(rows).toEqual([{ verified_emails: [] }]);
});
