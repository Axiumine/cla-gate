// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { loadMigrationFiles } from './migration-files.ts';
import { migrate } from './migrator.ts';
import { emptyTestDatabase, MIGRATIONS_DIRECTORY, migratedTestDatabase } from './test-support.ts';

// Migration 021 (E21-S04): sessions.verified_email_domains, the domains of the verified addresses a person had at login, kept as long as the session.

const CHECK = { code: '23514' };
const NOT_NULL = { code: '23502' };

const domains = (count: number): string[] => Array.from({ length: count }, (_, index) => `d${index}.example`);

/** Inserts a session of a new person with `value` as its domains (`undefined`: the column is left out) and answers what was stored. */
async function insertSession(value: readonly (string | null)[] | null | undefined) {
  const { db } = await migratedTestDatabase();
  await sql`insert into users (github_id, login) values (1001, 'login-1001')`.execute(db);
  const column = value === undefined ? sql`` : sql`, verified_email_domains`;
  const stored = value === undefined ? sql`` : sql`, ${value}::text[]`;
  return sql<{ verified_email_domains: string[] }>`
    insert into sessions (session_hash, user_id, csrf_secret, idle_expires_at, absolute_expires_at ${column})
    select repeat('a', 64), id, 'csrf', now() + interval '1 hour', now() + interval '2 hours' ${stored} from users
    returning verified_email_domains`.execute(db);
}

test('the column is a text array, not null, and holds an empty array unless told otherwise', async () => {
  const { db } = await migratedTestDatabase();
  const { rows } = await sql<{ data_type: string; udt_name: string; is_nullable: string; column_default: string }>`
    select data_type, udt_name, is_nullable, column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'sessions' and column_name = 'verified_email_domains'`.execute(db);
  expect(rows).toEqual([{ data_type: 'ARRAY', udt_name: '_text', is_nullable: 'NO', column_default: "'{}'::text[]" }]);
  expect((await insertSession(undefined)).rows).toEqual([{ verified_email_domains: [] }]);
});

test.each([[0], [1], [19], [20]])('a list of %i domains is accepted', async (count) => {
  const { rows } = await insertSession(domains(count));
  expect(rows[0]?.verified_email_domains).toEqual(domains(count));
});

test('hostnames in the stored form are accepted: digits, hyphens, dots and a punycode label', async () => {
  const stored = ['acme.com', 'a-1.b2-c.example', 'xn--bcher-kva.example', 'localhost'];
  expect((await insertSession(stored)).rows[0]?.verified_email_domains).toEqual(stored);
});

test.each([[21], [100]])('a list of %i domains is refused by the database', async (count) => {
  await expect(insertSession(domains(count))).rejects.toMatchObject(CHECK);
});

test.each([
  ['an address', ['ada@acme.com']],
  ['an upper-case letter', ['Acme.com']],
  ['a space inside', ['ac me.com']],
  ['an empty element', ['acme.com', '']],
  ['an element with nothing but a space', [' ']],
  ['an underscore', ['ac_me.com']],
  ['an SQL null element', ['acme.com', null]],
  ['a comma', ['acme.com,evil.test']],
  ['a newline', ['acme.com\nevil.test']],
])('%s in the list is refused by the database, so an address can never be kept here', async (_label, value) => {
  await expect(insertSession(value)).rejects.toMatchObject(CHECK);
});

test('an SQL null for the whole column is refused', async () => {
  await expect(insertSession(null)).rejects.toMatchObject(NOT_NULL);
});

test('a session that existed before the migration holds an empty list afterwards', async () => {
  const { db } = await emptyTestDatabase();
  const files = await loadMigrationFiles(MIGRATIONS_DIRECTORY);
  await migrate(
    db,
    files.filter((file) => file.name < '021'),
  );
  await sql`insert into users (github_id, login) values (1001, 'login-1001')`.execute(db);
  await sql`insert into sessions (session_hash, user_id, csrf_secret, idle_expires_at, absolute_expires_at)
    select repeat('b', 64), id, 'csrf', now() + interval '1 hour', now() + interval '2 hours' from users`.execute(db);
  await migrate(db, files);
  const { rows } = await sql`select verified_email_domains from sessions`.execute(db);
  expect(rows).toEqual([{ verified_email_domains: [] }]);
});
