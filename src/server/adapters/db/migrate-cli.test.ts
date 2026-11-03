// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { type Kysely, sql } from 'kysely';
import { expect, test, vi } from 'vitest';
import type { QueueMigration, QueueMigrationOptions } from '../jobs/migrate-queues.ts';
import { type MigrateCliOptions, runMigrateCli } from './migrate-cli.ts';
import { loadMigrationFiles, toMigrationFile } from './migration-files.ts';
import { migrate } from './migrator.ts';
import { openPgliteDatabase } from './pglite.ts';
import type { Database } from './schema.ts';
import { MIGRATIONS_DIRECTORY, writeMigrationDirectory } from './test-support.ts';

// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_password -- made-up value: the tests prove that the password never reaches the output
const URL_WITH_PASSWORD = 'postgres://owner:s3cr3t-pw@db.internal:5432/cla';
const ENV = { DATABASE_URL: URL_WITH_PASSWORD };
const SOME_FUNCTION: unknown = expect.any(Function);

type QueueStep = NonNullable<MigrateCliOptions['queueStep']>;

/** The queue step of E07-S01 with pg-boss out of the picture: it finds every queue in place and the grants done. */
const upToDate = (): Promise<QueueMigration> => Promise.resolve({ created: [], updated: [], grants: 'granted' });

/** Capturing sinks and a queue step that changes nothing, for the tests that are about the migrations. */
function sinks(queueStep: QueueStep = upToDate): {
  out: string[];
  err: string[];
  io: { out: (line: string) => void; err: (line: string) => void; queueStep: QueueStep };
} {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (line) => out.push(line), err: (line) => err.push(line), queueStep } };
}

const A = { '001_a.sql': 'create table a (id integer);' };

test('it applies the pending migrations, says so, and closes the connection', async () => {
  const db = await openPgliteDatabase();
  const { out, err, io } = sinks();
  const directory = await writeMigrationDirectory(A);
  expect(await runMigrateCli({ env: ENV, directory, connect: () => db, ...io })).toBe(0);
  expect(out).toEqual(['migrations applied: 001_a.sql', 'job queues: up to date']);
  expect(err).toEqual([]);
  await expect(sql`select 1`.execute(db)).rejects.toThrow('driver has already been destroyed');
});

test('with nothing pending it says the database is up to date', async () => {
  const db = await openPgliteDatabase();
  const directory = await writeMigrationDirectory(A);
  await migrate(db, await loadMigrationFiles(directory));
  const { out, io } = sinks();
  expect(await runMigrateCli({ env: ENV, directory, connect: () => db, ...io })).toBe(0);
  expect(out).toEqual(['migrations: up to date', 'job queues: up to date']);
});

test('several applied migrations are listed in order, separated by a comma and a space', async () => {
  const db = await openPgliteDatabase();
  const { out, io } = sinks();
  const directory = await writeMigrationDirectory({ ...A, '002_b.sql': 'create table b (id integer);' });
  expect(await runMigrateCli({ env: ENV, directory, connect: () => db, ...io })).toBe(0);
  expect(out).toEqual(['migrations applied: 001_a.sql, 002_b.sql', 'job queues: up to date']);
});

test('the real migrations apply cleanly through the CLI', async () => {
  const { out, io } = sinks();
  const db = await openPgliteDatabase();
  expect(await runMigrateCli({ env: ENV, directory: MIGRATIONS_DIRECTORY, connect: () => db, ...io })).toBe(0);
  const names = (await loadMigrationFiles(MIGRATIONS_DIRECTORY)).map((file) => file.name);
  expect(out).toEqual([`migrations applied: ${names.join(', ')}`, 'job queues: up to date']);
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

test.each([
  ['a string code stands in for an empty message', 'ECONNREFUSED', 'ECONNREFUSED'],
  ['a numeric code is not a code', 5, 'no details'],
])('an error with no message: %s', async (_label, code, shown) => {
  const { err, io } = sinks();
  const directory = await writeMigrationDirectory({});
  const broken = (): Kysely<Database> => {
    throw Object.assign(new Error(''), { code });
  };
  expect(await runMigrateCli({ env: ENV, directory, connect: broken, ...io })).toBe(1);
  expect(err).toEqual([`migration failed: Error: ${shown}`]);
});

test('without custom sinks it writes to stdout', async () => {
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const db = await openPgliteDatabase();
  const directory = await writeMigrationDirectory({});
  expect(await runMigrateCli({ env: ENV, directory, connect: () => db, queueStep: upToDate })).toBe(0);
  expect(stdout.mock.calls).toEqual([['migrations: up to date\n'], ['job queues: up to date\n']]);
});

test('the queue step runs after the migrations, on the connection of the owner, with its own connection string', async () => {
  const db = await openPgliteDatabase();
  const { out, io } = sinks();
  const queueStep = vi.fn<QueueStep>(async () => {
    out.push('queue step');
    await expect(sql`select 1`.execute(db)).resolves.toBeDefined();
    return { created: [], updated: [], grants: 'granted' };
  });
  const directory = await writeMigrationDirectory(A);
  expect(await runMigrateCli({ env: ENV, directory, connect: () => db, ...io, queueStep })).toBe(0);
  expect(queueStep).toHaveBeenCalledExactlyOnceWith({
    connectionString: URL_WITH_PASSWORD,
    db,
    onError: SOME_FUNCTION,
  });
  expect(out).toEqual(['migrations applied: 001_a.sql', 'queue step', 'job queues: up to date']);
  await expect(sql`select 1`.execute(db)).rejects.toThrow('driver has already been destroyed');
});

test('errors pg-boss reports on its own connections are reported like those of the pool', async () => {
  const db = await openPgliteDatabase();
  const { err, io } = sinks();
  const queueStep: QueueStep = (options: QueueMigrationOptions) => {
    options.onError(new Error('connection reset'));
    return upToDate();
  };
  await runMigrateCli({ env: ENV, directory: await writeMigrationDirectory({}), connect: () => db, ...io, queueStep });
  expect(err).toEqual(['database error: Error: connection reset']);
});

test('the queues the step created are listed in order', async () => {
  const db = await openPgliteDatabase();
  const queueStep: QueueStep = () =>
    Promise.resolve({ created: ['evaluate-pr', 'sweep'], updated: [], grants: 'granted' });
  const { out, io } = sinks(queueStep);
  const directory = await writeMigrationDirectory({});
  expect(await runMigrateCli({ env: ENV, directory, connect: () => db, ...io })).toBe(0);
  expect(out).toEqual(['migrations: up to date', 'job queues created: evaluate-pr, sweep']);
});

test('the queues the step brought in line with the definitions (E07-S05) are listed after the created ones, and then the queues are not up to date', async () => {
  const db = await openPgliteDatabase();
  const queueStep: QueueStep = () =>
    Promise.resolve({ created: ['job-dead-letter'], updated: ['evaluate-pr', 'sweep'], grants: 'granted' });
  const { out, io } = sinks(queueStep);
  const directory = await writeMigrationDirectory({});
  expect(await runMigrateCli({ env: ENV, directory, connect: () => db, ...io })).toBe(0);
  expect(out).toEqual([
    'migrations: up to date',
    'job queues created: job-dead-letter',
    'job queues updated: evaluate-pr, sweep',
  ]);
});

test('queues that only needed their bounds brought in line say so and are not reported as up to date', async () => {
  const db = await openPgliteDatabase();
  const queueStep: QueueStep = () => Promise.resolve({ created: [], updated: ['sweep'], grants: 'granted' });
  const { out, io } = sinks(queueStep);
  const directory = await writeMigrationDirectory({});
  expect(await runMigrateCli({ env: ENV, directory, connect: () => db, ...io })).toBe(0);
  expect(out).toEqual(['migrations: up to date', 'job queues updated: sweep']);
});

test('without the runtime role the skipped grants are said, on a line of their own', async () => {
  const db = await openPgliteDatabase();
  const queueStep: QueueStep = () => Promise.resolve({ created: [], updated: [], grants: 'skipped' });
  const { out, io } = sinks(queueStep);
  const directory = await writeMigrationDirectory({});
  expect(await runMigrateCli({ env: ENV, directory, connect: () => db, ...io })).toBe(0);
  expect(out).toEqual([
    'migrations: up to date',
    'job queues: up to date',
    'role cla_app does not exist: pgboss runtime grants skipped',
  ]);
});

test('a failing queue step fails the run after the migrations were applied, and the connection is still closed', async () => {
  const db = await openPgliteDatabase();
  const queueStep: QueueStep = () => Promise.reject(new Error('pg-boss could not start'));
  const { out, err, io } = sinks(queueStep);
  const directory = await writeMigrationDirectory(A);
  expect(await runMigrateCli({ env: ENV, directory, connect: () => db, ...io })).toBe(1);
  expect(out).toEqual(['migrations applied: 001_a.sql']);
  expect(err).toEqual(['migration failed: Error: pg-boss could not start']);
  await expect(sql`select 1`.execute(db)).rejects.toThrow('driver has already been destroyed');
});

test('without a queue step given it is the pg-boss one: after the migrations an unreachable database fails the run, with no password', async () => {
  const db = await openPgliteDatabase();
  const { out, err, io } = sinks();
  const owner = { DATABASE_URL: 'postgres://owner:s3cr3t-pw@127.0.0.1:1/cla' };
  expect(
    await runMigrateCli({
      env: owner,
      directory: await writeMigrationDirectory(A),
      connect: () => db,
      out: io.out,
      err: io.err,
    }),
  ).toBe(1);
  expect(out).toEqual(['migrations applied: 001_a.sql']);
  expect(err.join('\n')).toContain('migration failed: ');
  expect(err.join('\n')).not.toContain('s3cr3t-pw');
});
