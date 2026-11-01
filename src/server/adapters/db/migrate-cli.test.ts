// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { type Kysely, sql } from 'kysely';
import { expect, test, vi } from 'vitest';
import { type MigrateCliOptions, runMigrateCli } from './migrate-cli.ts';
import { loadMigrationFiles, toMigrationFile } from './migration-files.ts';
import { migrate } from './migrator.ts';
import { openPgliteDatabase } from './pglite.ts';
import type { Database } from './schema.ts';
import { MIGRATIONS_DIRECTORY, writeMigrationDirectory } from './test-support.ts';

const URL_WITH_PASSWORD = 'postgres://owner:s3cr3t-pw@db.internal:5432/cla';
const ENV = { DATABASE_URL: URL_WITH_PASSWORD };

function sinks(): { out: string[]; err: string[]; io: { out: (line: string) => void; err: (line: string) => void } } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (line) => out.push(line), err: (line) => err.push(line) } };
}

const A = { '001_a.sql': 'create table a (id integer);' };

test('it applies the pending migrations, says so, and closes the connection', async () => {
  const db = await openPgliteDatabase();
  const { out, err, io } = sinks();
  const directory = await writeMigrationDirectory(A);
  expect(await runMigrateCli({ env: ENV, directory, connect: () => db, ...io })).toBe(0);
  expect(out).toEqual(['migrations applied: 001_a.sql']);
  expect(err).toEqual([]);
  await expect(sql`select 1`.execute(db)).rejects.toThrow('driver has already been destroyed');
});

test('with nothing pending it says the database is up to date', async () => {
  const db = await openPgliteDatabase();
  const directory = await writeMigrationDirectory(A);
  await migrate(db, await loadMigrationFiles(directory));
  const { out, io } = sinks();
  expect(await runMigrateCli({ env: ENV, directory, connect: () => db, ...io })).toBe(0);
  expect(out).toEqual(['migrations: up to date']);
});

test('the real migrations apply cleanly through the CLI', async () => {
  const { out, io } = sinks();
  const db = await openPgliteDatabase();
  expect(await runMigrateCli({ env: ENV, directory: MIGRATIONS_DIRECTORY, connect: () => db, ...io })).toBe(0);
  expect(out).toEqual(['migrations applied: 001_initial.sql']);
});

test('the owner connection (MIGRATION_DATABASE_URL) wins over the runtime one (DATABASE_URL)', async () => {
  const owner = 'postgres://owner:owner-pw@db.internal/cla';
  const directory = await writeMigrationDirectory({});
  const db = await openPgliteDatabase();
  const connect = vi.fn<NonNullable<MigrateCliOptions['connect']>>(() => db);
  const { io } = sinks();
  await runMigrateCli({ env: { ...ENV, MIGRATION_DATABASE_URL: owner }, directory, connect, ...io });
  expect(connect).toHaveBeenCalledExactlyOnceWith(owner, expect.any(Function));
});

test('errors on idle pooled connections are reported without a stack', async () => {
  const db = await openPgliteDatabase();
  const connect = vi.fn<NonNullable<MigrateCliOptions['connect']>>(() => db);
  const { err, io } = sinks();
  await runMigrateCli({ env: ENV, directory: await writeMigrationDirectory({}), connect, ...io });
  connect.mock.calls[0]?.[1](new Error('connection reset'));
  expect(err).toEqual(['database error: Error: connection reset']);
});

test('an invalid environment fails before any connection is made', async () => {
  const connect = vi.fn();
  const { err, io } = sinks();
  const directory = await writeMigrationDirectory(A);
  expect(await runMigrateCli({ env: { DATABASE_URL: 'mysql://u:hunter2@h/db' }, directory, connect, ...io })).toBe(1);
  expect(err).toEqual(['migration failed: Invalid environment configuration: DATABASE_URL']);
  expect(connect).not.toHaveBeenCalled();
});

test('a missing migrations directory fails', async () => {
  const { err, io } = sinks();
  const connect = vi.fn();
  expect(await runMigrateCli({ env: ENV, directory: '/nonexistent/cla-migrations', connect, ...io })).toBe(1);
  expect(err.join()).toContain('ENOENT');
  expect(connect).not.toHaveBeenCalled();
});

test('an edited migration fails with its explanation, and the connection is still closed', async () => {
  const db = await openPgliteDatabase();
  await migrate(db, [toMigrationFile('001_a.sql', 'create table a (id integer, old text);')]);
  const { err, io } = sinks();
  const directory = await writeMigrationDirectory(A);
  expect(await runMigrateCli({ env: ENV, directory, connect: () => db, ...io })).toBe(1);
  expect(err).toHaveLength(1);
  expect(err[0]).toContain('migration failed: applied migration 001_a.sql was edited after it was applied');
  await expect(sql`select 1`.execute(db)).rejects.toThrow('driver has already been destroyed');
});

test('an unreachable database fails with the error code and never prints the password', async () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const directory = await writeMigrationDirectory(A);
  const env = { DATABASE_URL: 'postgres://owner:s3cr3t-pw@127.0.0.1:1/cla' };
  expect(await runMigrateCli({ env, directory })).toBe(1);
  const printed = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
  expect(printed).toContain('migration failed: ');
  expect(printed).toContain('ECONNREFUSED');
  expect(printed).not.toContain('s3cr3t-pw');
});

test('errors that carry no message or are not errors still produce one line', async () => {
  const { err, io } = sinks();
  const directory = await writeMigrationDirectory({});
  const silent = (): Kysely<Database> => {
    throw new Error('');
  };
  const weird = (): Kysely<Database> => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- exercises the branch for a thrown value that is not an Error
    throw 'a string';
  };
  expect(await runMigrateCli({ env: ENV, directory, connect: silent, ...io })).toBe(1);
  expect(await runMigrateCli({ env: ENV, directory, connect: weird, ...io })).toBe(1);
  expect(err).toEqual(['migration failed: Error: no details', 'migration failed: unknown error']);
});

test('without custom sinks it writes to stdout', async () => {
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const db = await openPgliteDatabase();
  const directory = await writeMigrationDirectory({});
  expect(await runMigrateCli({ env: ENV, directory, connect: () => db })).toBe(0);
  expect(stdout).toHaveBeenCalledExactlyOnceWith('migrations: up to date\n');
});
