// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { expect, test } from 'vitest';
import { MigrationError, toMigrationFile } from './migration-files.ts';
import { MIGRATION_LOCK_KEY, migrate } from './migrator.ts';
import type { Database } from './schema.ts';
import { backendPid, emptyTestDatabase, realPostgresOnly, waitUntilBlocked, withConnections } from './test-support.ts';

const A = toMigrationFile('001_a.sql', 'create table a (id integer);');
const B = toMigrationFile('002_b.sql', 'create table b (id integer);');

async function tables(db: Kysely<Database>): Promise<string[]> {
  const { rows } = await sql<{ table_name: string }>`
    select table_name from information_schema.tables where table_schema = 'public' order by table_name`.execute(db);
  return rows.map((row) => row.table_name);
}

async function recorded(db: Kysely<Database>): Promise<string[]> {
  const { rows } = await sql<{ name: string }>`select name from schema_migrations order by name`.execute(db);
  return rows.map((row) => row.name);
}

/** Advisory locks currently held on the migration key by any session. */
async function heldLocks(db: Kysely<Database>): Promise<number> {
  const classid = Math.floor(MIGRATION_LOCK_KEY / 2 ** 32);
  const objid = MIGRATION_LOCK_KEY % 2 ** 32;
  const { rows } = await sql<{ n: number }>`
    select count(*)::int as n from pg_locks
    where locktype = 'advisory' and classid = ${classid} and objid = ${objid}`.execute(db);
  return rows[0]?.n ?? -1;
}

test('pending migrations are applied in name order and recorded with their checksum', async () => {
  const { db } = await emptyTestDatabase();
  expect(await migrate(db, [B, A])).toEqual(['001_a.sql', '002_b.sql']);
  expect(await tables(db)).toEqual(['a', 'b', 'schema_migrations']);
  const { rows } = await sql<{
    name: string;
    checksum: string;
  }>`select name, checksum from schema_migrations order by name`.execute(db);
  expect(rows).toEqual([
    { name: '001_a.sql', checksum: A.checksum },
    { name: '002_b.sql', checksum: B.checksum },
  ]);
});

test('running again changes nothing', async () => {
  const { db } = await emptyTestDatabase();
  await migrate(db, [A, B]);
  expect(await migrate(db, [A, B])).toEqual([]);
  expect(await recorded(db)).toEqual(['001_a.sql', '002_b.sql']);
});

test('a later run applies only the new migration', async () => {
  const { db } = await emptyTestDatabase();
  await migrate(db, [A]);
  expect(await migrate(db, [A, B])).toEqual(['002_b.sql']);
});

test('no migrations at all still prepares the bookkeeping table', async () => {
  const { db } = await emptyTestDatabase();
  expect(await migrate(db, [])).toEqual([]);
  expect(await tables(db)).toEqual(['schema_migrations']);
});

test('an edited migration refuses the whole run, naming the file but never its SQL', async () => {
  const { db } = await emptyTestDatabase();
  await migrate(db, [A]);
  const edited = toMigrationFile('001_a.sql', 'create table a (id integer, secret_column text);');
  const run = migrate(db, [edited, B]);
  await expect(run).rejects.toThrow(MigrationError);
  await expect(run).rejects.toThrow('applied migration 001_a.sql was edited after it was applied');
  await expect(run).rejects.toThrow('migrations are forward-only: restore the file and add a new migration instead');
  await expect(run).rejects.not.toThrow('secret_column');
  expect(await tables(db)).toEqual(['a', 'schema_migrations']);
});

test('a removed migration refuses the run', async () => {
  const { db } = await emptyTestDatabase();
  await migrate(db, [A, B]);
  await expect(migrate(db, [B])).rejects.toThrow(
    'applied migration 001_a.sql is missing from the migrations directory',
  );
});

test('a new migration that sorts before an applied one refuses the run', async () => {
  const { db } = await emptyTestDatabase();
  await migrate(db, [B]);
  await expect(migrate(db, [A, B])).rejects.toThrow(
    'pending migration 001_a.sql is older than the applied migration 002_b.sql; migrations must be added in order',
  );
  expect(await tables(db)).toEqual(['b', 'schema_migrations']);
});

test('a failing migration rolls back by itself and keeps the ones before it', async () => {
  const { db } = await emptyTestDatabase();
  const broken = toMigrationFile('002_broken.sql', 'create table half (id integer); select 1 / 0;');
  await expect(
    migrate(db, [A, broken, toMigrationFile('003_c.sql', 'create table c (id integer);')]),
  ).rejects.toMatchObject({
    code: '22012',
  });
  expect(await tables(db)).toEqual(['a', 'schema_migrations']);
  expect(await recorded(db)).toEqual(['001_a.sql']);
  expect(await migrate(db, [A, B])).toEqual(['002_b.sql']);
});

test('migrations run while the advisory lock is held, and it is released afterwards', async () => {
  const { db } = await emptyTestDatabase();
  const probe = toMigrationFile(
    '001_probe.sql',
    `create table probe as select count(*)::int as held from pg_locks
       where locktype = 'advisory' and pid = pg_backend_pid();`,
  );
  await migrate(db, [probe]);
  const { rows } = await sql<{ held: number }>`select held from probe`.execute(db);
  expect(rows).toEqual([{ held: 1 }]);
  expect(await heldLocks(db)).toBe(0);
});

test('the advisory lock is released when a migration fails', async () => {
  const { db } = await emptyTestDatabase();
  await expect(migrate(db, [toMigrationFile('001_bad.sql', 'select 1 / 0;')])).rejects.toThrow();
  expect(await heldLocks(db)).toBe(0);
});

test('concurrent runners apply each migration exactly once', async () => {
  const { db } = await emptyTestDatabase();
  const results = await Promise.all([migrate(db, [A, B]), migrate(db, [A, B]), migrate(db, [A, B])]);
  expect(results.flat().toSorted((a, b) => a.localeCompare(b))).toEqual(['001_a.sql', '002_b.sql']);
  expect(await recorded(db)).toEqual(['001_a.sql', '002_b.sql']);
});

// PGlite has a single session, and advisory locks are re-entrant within a session, so a lock held "elsewhere" could
// never contend there. Only a real server can prove that a second runner waits.
realPostgresOnly('a runner waits while another session holds the advisory lock', async () => {
  const { db } = await emptyTestDatabase();
  const connections = withConnections(2);
  const holder = connections.get(0);
  const runner = connections.get(1);
  const waiter = await backendPid(runner);
  await sql`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`.execute(holder);
  const run = migrate(runner, [A]);
  await waitUntilBlocked(db, waiter);
  expect(await tables(db)).toEqual([]);
  await sql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`.execute(holder);
  await expect(run).resolves.toEqual(['001_a.sql']);
  expect(await tables(db)).toEqual(['a', 'schema_migrations']);
});
