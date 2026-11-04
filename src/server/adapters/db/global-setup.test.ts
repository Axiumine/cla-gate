// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { randomBytes } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import pg from 'pg';
import { expect, inject, onTestFinished, test } from 'vitest';
import { type SetupProject, setupTestDatabase } from './global-setup.ts';
import type { Database } from './schema.ts';
import {
  ALLOW_APP_DATABASE,
  APP_DATABASE_QUERY,
  appDatabaseRefusal,
  type Inspection,
  refusalFor,
  testDatabaseUrl,
} from './test-database-guard/test-support.ts';
import { emptyTestDatabase, migratedTestDatabase, realPostgresOnly, requireTestDatabaseUrl } from './test-support.ts';

// E19-S10: the guard that keeps the test suite away from real data. The first group needs no server: the pieces of the guard
// and the query it asks the database, which runs on PGlite and on a real server alike. The second group runs the suite's
// global setup and teardown against a real server (the CI `postgres` job, or `yarn test` with DATABASE_URL set) and
// watches a sentinel database: it must come out of a run as it went in, and the run must leave no database behind.

interface Provided {
  readonly project: SetupProject;
  readonly values: Map<string, unknown>;
}

/** A project that records what the setup hands to the tests. */
function recordingProject(): Provided {
  const values = new Map<string, unknown>();
  return {
    values,
    project: {
      provide: (key, value) => {
        values.set(key, value);
      },
    },
  };
}

/** What {@link APP_DATABASE_QUERY} answers for the database `db` is connected to. */
async function inspectionOf(db: Kysely<Database>): Promise<Inspection> {
  const { rows } = await sql<Inspection>`${sql.raw(APP_DATABASE_QUERY)}`.execute(db);
  return rows[0] ?? { name: '', holds_migrations: false };
}

// --------------------------------------------------------------------------------------------- the pieces, any engine

test('without a database URL the setup prepares nothing and tells the tests to use PGlite', async () => {
  const absent = recordingProject();
  const empty = recordingProject();
  expect(await setupTestDatabase(absent.project, {})).toBeUndefined();
  expect(await setupTestDatabase(empty.project, { DATABASE_URL: '' })).toBeUndefined();
  expect(absent.values).toEqual(new Map([['testDatabaseUrl', undefined]]));
  expect(empty.values).toEqual(new Map([['testDatabaseUrl', undefined]]));
});

test('the URL of the throw-away database keeps the server, the credentials and the options and replaces only the database', () => {
  const url = 'postgres://tester:pa%40ss@127.0.0.1:40123/cla?sslmode=disable&application_name=cla';
  expect(testDatabaseUrl(url, 'cla_test_0123456789ab')).toBe(
    'postgres://tester:pa%40ss@127.0.0.1:40123/cla_test_0123456789ab?sslmode=disable&application_name=cla',
  );
  expect(testDatabaseUrl('postgres://tester:pw@127.0.0.1:40123', 'cla_test_x')).toBe(
    'postgres://tester:pw@127.0.0.1:40123/cla_test_x',
  );
});

test('the refusal names the database, the way out and the document, and never the URL', () => {
  const message = appDatabaseRefusal('cla');
  expect(message).toContain('DATABASE_URL names the database "cla", which already contains schema_migrations');
  expect(message).toContain('has created nothing');
  expect(message).toContain('docs/development/test-database.md');
  expect(message).toContain(`${ALLOW_APP_DATABASE}=1`);
  expect(message).not.toContain('postgres://');
  expect(appDatabaseRefusal('odd"name')).toContain(String.raw`"odd\"name"`);
});

test.each([
  ['a database without the migrations table, whatever the flag says', false, undefined],
  ['a database without the migrations table and the flag set', false, '1'],
  ['the migrations table and the flag set to 1', true, '1'],
])('the guard lets a run through for %s', (_name, holds, allowed) => {
  expect(refusalFor({ name: 'cla', holds_migrations: holds }, allowed)).toBeUndefined();
});

test.each([
  ['no flag', undefined],
  ['0', '0'],
  ['true', 'true'],
  ['yes', 'yes'],
  ['an empty value', ''],
  ['1 with a space', '1 '],
])('the guard refuses a database with the migrations table when the flag is %s', (_name, allowed) => {
  expect(refusalFor({ name: 'cla', holds_migrations: true }, allowed)).toBe(appDatabaseRefusal('cla'));
});

test('the query finds the migrations table of a migrated database and names the database it ran in', async () => {
  const { db } = await migratedTestDatabase();
  const found = await inspectionOf(db);
  expect(found.holds_migrations).toBe(true);
  expect(found.name).not.toBe('');
});

test('the query finds nothing in a database without the migrations table', async () => {
  const { db } = await emptyTestDatabase();
  expect((await inspectionOf(db)).holds_migrations).toBe(false);
});

test('the query finds the table in any schema, whatever the search path of the role says', async () => {
  const { db } = await emptyTestDatabase();
  await sql`create schema elsewhere`.execute(db);
  // Only the `public` schema is reset between tests, so this one is dropped by the test itself.
  onTestFinished(async () => {
    await sql`drop schema elsewhere cascade`.execute(db);
  });
  await sql`create table elsewhere.schema_migrations (name text primary key)`.execute(db);
  expect((await inspectionOf(db)).holds_migrations).toBe(true);
});

test.each([
  ['a view with that name', 'create view schema_migrations as select 1 as name'],
  ['a table with another name', 'create table schema_migration (name text primary key)'],
  ['a column with that name', 'create table notes (schema_migrations text)'],
])('the query is not fooled by %s', async (_name, statement) => {
  const { db } = await emptyTestDatabase();
  await sql.raw(statement).execute(db);
  expect((await inspectionOf(db)).holds_migrations).toBe(false);
});

// ----------------------------------------------------------------------------------------- the guard, a real server only

/** A connection to the server of this run, and the sentinel databases made through it; all of it is removed after the test. */
interface World {
  readonly admin: pg.Client;
  readonly serverUrl: string;
  readonly sentinel: (options?: { readonly withMigrations?: boolean }) => Promise<Sentinel>;
}

interface Sentinel {
  readonly name: string;
  readonly url: string;
}

/** Everything a database holds, as `{ table: rows }` in the `public` schema: what must come out of a run unchanged. */
type Contents = Record<string, unknown[]>;

async function connected(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

async function createWorld(): Promise<World> {
  const serverUrl = requireTestDatabaseUrl(inject('testDatabaseUrl'));
  const admin = await connected(serverUrl);
  const names: string[] = [];
  onTestFinished(async () => {
    for (const name of names) {
      await admin.query(`drop database if exists ${admin.escapeIdentifier(name)} with (force)`);
    }
    await admin.end();
  });
  return {
    admin,
    serverUrl,
    sentinel: async (options) => {
      const name = `cla_sentinel_${randomBytes(6).toString('hex')}`;
      names.push(name);
      await admin.query(`create database ${admin.escapeIdentifier(name)}`);
      const url = testDatabaseUrl(serverUrl, name);
      const client = await connected(url);
      try {
        await client.query('create table sentinel_items (id integer primary key, note text not null)');
        await client.query("insert into sentinel_items values (1, 'keep me'), (2, 'and me')");
        if (options?.withMigrations === true) {
          await client.query('create table schema_migrations (name text primary key, checksum text not null)');
          await client.query("insert into schema_migrations values ('001_init.sql', 'sum')");
        }
      } finally {
        await client.end();
      }
      return { name, url };
    },
  };
}

const alphabetical = (a: string, b: string): number => a.localeCompare(b);

/** The databases of the server, in one order that does not depend on the collation of the server. */
async function databasesOf(admin: pg.Client): Promise<string[]> {
  const { rows } = await admin.query<{ datname: string }>('select datname from pg_database');
  return rows.map((row) => row.datname).sort(alphabetical);
}

async function contentsOf(url: string): Promise<Contents> {
  const client = await connected(url);
  try {
    const { rows: tables } = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    const entries: [string, unknown[]][] = [];
    for (const { table_name: table } of tables) {
      const { rows } = await client.query<Record<string, unknown>>(
        `select * from ${client.escapeIdentifier(table)} order by 1`,
      );
      entries.push([table, rows]);
    }
    return Object.fromEntries(entries);
  } finally {
    await client.end();
  }
}

/** The name of the database in the URL the setup handed to the tests. */
function databaseOf(provided: Provided): string {
  const url = provided.values.get('testDatabaseUrl');
  if (typeof url !== 'string') {
    throw new TypeError('the setup did not provide a database URL');
  }
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

const SENTINEL_ROWS = [
  { id: 1, note: 'keep me' },
  { id: 2, note: 'and me' },
];

realPostgresOnly(
  'a run of the global setup and teardown leaves a sentinel database and the set of databases as they were',
  async () => {
    const { admin, sentinel } = await createWorld();
    const watched = await sentinel();
    const before = await databasesOf(admin);
    const contents = await contentsOf(watched.url);
    expect(contents).toEqual({ sentinel_items: SENTINEL_ROWS });

    const provided = recordingProject();
    const teardown = await setupTestDatabase(provided.project, { DATABASE_URL: watched.url });

    const created = databaseOf(provided);
    expect(created).toMatch(/^cla_test_[0-9a-f]{12}$/);
    expect(created).not.toBe(watched.name);
    expect(await databasesOf(admin)).toEqual([...before, created].sort(alphabetical));
    expect(await contentsOf(watched.url)).toEqual(contents);

    await teardown?.();
    expect(await databasesOf(admin)).toEqual(before);
    expect(await contentsOf(watched.url)).toEqual(contents);
  },
);

realPostgresOnly('the throw-away database is a separate, empty database on the same server', async () => {
  const { admin, sentinel } = await createWorld();
  const watched = await sentinel();
  const provided = recordingProject();
  const teardown = await setupTestDatabase(provided.project, { DATABASE_URL: watched.url });
  onTestFinished(async () => {
    await teardown?.();
  });

  const url = new URL(String(provided.values.get('testDatabaseUrl')));
  const origin = new URL(watched.url);
  expect([url.protocol, url.username, url.password, url.host]).toEqual([
    origin.protocol,
    origin.username,
    origin.password,
    origin.host,
  ]);
  expect(await contentsOf(url.href)).toEqual({});
  expect(await databasesOf(admin)).toContain(databaseOf(provided));
});

realPostgresOnly(
  'a database that holds schema_migrations is refused with a clear message and nothing is created',
  async () => {
    const { admin, sentinel } = await createWorld();
    const watched = await sentinel({ withMigrations: true });
    const before = await databasesOf(admin);
    const contents = await contentsOf(watched.url);
    const provided = recordingProject();

    const refused = setupTestDatabase(provided.project, { DATABASE_URL: watched.url });

    await expect(refused).rejects.toThrow(appDatabaseRefusal(watched.name));
    await expect(refused).rejects.not.toThrow(watched.url);
    expect(provided.values.size).toBe(0);
    expect(await databasesOf(admin)).toEqual(before);
    expect(await contentsOf(watched.url)).toEqual(contents);
  },
);

realPostgresOnly('only the value 1 lifts the refusal: 0, true, yes and an empty value do not', async () => {
  const { admin, sentinel } = await createWorld();
  const watched = await sentinel({ withMigrations: true });
  const before = await databasesOf(admin);

  const attempts = ['0', 'true', 'yes', ''].map((value) =>
    setupTestDatabase(recordingProject().project, { DATABASE_URL: watched.url, [ALLOW_APP_DATABASE]: value }),
  );

  const outcomes = await Promise.allSettled(attempts);
  expect(outcomes.map((outcome) => outcome.status)).toEqual(['rejected', 'rejected', 'rejected', 'rejected']);
  expect(await databasesOf(admin)).toEqual(before);
});

realPostgresOnly(
  'CLA_TEST_ALLOW_APP_DATABASE=1 lets the run go ahead and still leaves the named database untouched',
  async () => {
    const { admin, sentinel } = await createWorld();
    const watched = await sentinel({ withMigrations: true });
    const before = await databasesOf(admin);
    const contents = await contentsOf(watched.url);
    expect(Object.keys(contents)).toEqual(['schema_migrations', 'sentinel_items']);
    const provided = recordingProject();

    const teardown = await setupTestDatabase(provided.project, {
      DATABASE_URL: watched.url,
      [ALLOW_APP_DATABASE]: '1',
    });

    const created = databaseOf(provided);
    expect(created).toMatch(/^cla_test_[0-9a-f]{12}$/);
    expect(await databasesOf(admin)).toEqual([...before, created].sort(alphabetical));
    await teardown?.();
    expect(await databasesOf(admin)).toEqual(before);
    expect(await contentsOf(watched.url)).toEqual(contents);
  },
);
