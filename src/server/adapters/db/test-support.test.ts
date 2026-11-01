// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import {
  emptyTestDatabase,
  ensureRuntimeRole,
  migratedTestDatabase,
  openTestDatabase,
  realPostgres,
  resetDatabase,
  seedTenant,
} from './test-support.ts';

test('a test database is Postgres 18, on PGlite or on the real server of the CI postgres job', async () => {
  const { kind, db } = await emptyTestDatabase();
  const { rows } = await sql<{ v: string }>`select current_setting('server_version_num') as v`.execute(db);
  expect(rows[0]?.v.slice(0, 2)).toBe('18');
  expect(kind).toBe(realPostgres ? 'postgres' : 'pglite');
});

test('a URL selects node-postgres without connecting, no URL selects PGlite', async () => {
  const postgres = await openTestDatabase('postgres://user:pw@127.0.0.1:1/db');
  expect(postgres.kind).toBe('postgres');
  await postgres.db.destroy();
  const pglite = await openTestDatabase(undefined);
  expect(pglite.kind).toBe('pglite');
  await pglite.db.destroy();
});

test('every test starts from an empty schema', async () => {
  const first = await migratedTestDatabase();
  await seedTenant(first.db);
  const second = await emptyTestDatabase();
  const { rows } = await sql<{
    n: number;
  }>`select count(*)::int as n from information_schema.tables where table_schema = 'public'`.execute(second.db);
  expect(rows).toEqual([{ n: 0 }]);
});

test('resetting twice in a row is harmless', async () => {
  const { db } = await migratedTestDatabase();
  await resetDatabase(db);
  await expect(resetDatabase(db)).resolves.toBeUndefined();
});

test('the runtime role is created once and then left alone', async () => {
  const { db } = await emptyTestDatabase();
  await ensureRuntimeRole(db);
  await expect(ensureRuntimeRole(db)).resolves.toBeUndefined();
  const { rows } = await sql<{ n: number }>`select count(*)::int as n from pg_roles where rolname = 'cla_app'`.execute(
    db,
  );
  expect(rows).toEqual([{ n: 1 }]);
});
