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

// E20-S03: an image or a PGlite pin that drifts to another major version fails here, on both drivers.
test('a test database is Postgres 18 (180000 up to 189999), on PGlite and on the real server of the CI postgres job', async () => {
  const { kind, db } = await emptyTestDatabase();
  const { rows } = await sql<{ server_version_num: string }>`show server_version_num`.execute(db);
  const version = Number(rows[0]?.server_version_num);
  expect(version).toBeGreaterThanOrEqual(180_000);
  expect(version).toBeLessThan(190_000);
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
