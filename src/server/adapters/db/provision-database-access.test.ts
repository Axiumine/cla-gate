// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { afterAll, expect, inject, onTestFinished, test } from 'vitest';
import { findOnPath } from '../../../../scripts/ci/lib/test-support.ts';
import { migrateJobQueues } from '../jobs/migrate-queues.ts';
import { loadMigrationFiles } from './migration-files.ts';
import { migrate } from './migrator.ts';
import { createPgDatabase } from './pg.ts';
import { MIGRATIONS_DIRECTORY, realPostgresRolesOnly, requireTestDatabaseUrl } from './test-support.ts';

// E19-S03: scripts/provision-database.sh against a real server, part two: what the roles can and cannot do afterwards, the
// development role, and the refusals of the SQL file itself (part one: provision-database.test.ts, whose header says how
// the harness below works; it is repeated here because a test file cannot import another).

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const SCRIPT = path.join(ROOT, 'scripts/provision-database.sh');
const SH = '/bin/sh';
const NAME_RULE = /^[a-z_][a-z0-9_]{0,62}$/;
const OWNER_PASSWORD = `owner-${randomBytes(10).toString('hex')}`;
const APP_PASSWORD = `app-${randomBytes(10).toString('hex')}`;
const FORWARDED = [
  'CLA_DB_NAME',
  'CLA_OWNER_ROLE',
  'CLA_TEST_ROLE',
  'CLA_OWNER_PASSWORD',
  'CLA_APP_PASSWORD',
  'CLA_TEST_PASSWORD',
  'NODE_ENV',
  'PGUSER',
];

const tempDirectories: string[] = [];
afterAll(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

/** A directory with a `psql` that runs in the CI container, or undefined when the host's psql is to be used. */
function containerClient(): string | undefined {
  const container = process.env['CLA_PG_CONTAINER'] ?? '';
  if (container === '') {
    return undefined;
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cla-provision-'));
  tempDirectories.push(directory);
  const forwarded = FORWARDED.map((name) => `-e ${name}`).join(' ');
  const shim = `#!/bin/sh\nexec docker exec -i ${forwarded} ${container} psql "$@"\n`;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a file inside a directory made by mkdtemp above
  fs.writeFileSync(path.join(directory, 'psql'), shim, { mode: 0o755 });
  return directory;
}

const client = containerClient();
const clientPath = [client, process.env['PATH']].filter((part) => part !== undefined).join(':');

interface Names {
  readonly db: string;
  readonly owner: string;
  readonly dev: string;
  readonly other: string;
}

const namesFor = (hex: string): Names => ({
  db: `cla_prov_${hex}`,
  owner: `prov_owner_${hex}`,
  dev: `prov_dev_${hex}`,
  other: `cla_prov_other_${hex}`,
});

function adminOf() {
  const url = new URL(requireTestDatabaseUrl(inject('testDatabaseUrl')));
  const [user, secret] = [url.username, url.password].map(decodeURIComponent);
  return { host: url.hostname, port: Number(url.port), user: user ?? '', password: secret ?? '' };
}

interface Outcome {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** What one test works with: its names, an administrator connection, the script, and connections as other roles. */
interface Cluster {
  readonly names: Names;
  readonly admin: pg.Client;
  /** The script, with the database and owner role of this test and the given inputs. */
  readonly run: (inputs?: Record<string, string>) => Outcome;
  /** `statement` as the administrator in database `db` (default: the maintenance database). */
  readonly query: (statement: string, db?: string, values?: unknown[]) => Promise<Record<string, unknown>[]>;
  /** A client of `user` with `secret`: it proves the password that was set. Closed after the test. */
  readonly connectAs: (user: string, secret: string, db: string) => Promise<pg.Client>;
}

/** Parks `cla_app`, registers the cleanup (this test's databases and roles go, `cla_app` is put back) and returns the connection. */
async function prepare(names: Names, connection: pg.ClientConfig): Promise<pg.Client> {
  const admin = new pg.Client({ ...connection, database: 'postgres' });
  await admin.connect();
  const parkedAs = admin.escapeIdentifier(`cla_app_parked_${names.db}`);
  const hadApp = (await admin.query("select 1 from pg_roles where rolname = 'cla_app'")).rowCount === 1;
  if (hadApp) {
    await admin.query(`alter role cla_app rename to ${parkedAs}`);
  }
  onTestFinished(async () => {
    for (const database of [names.db, names.other]) {
      await admin.query(`drop database if exists ${admin.escapeIdentifier(database)} with (force)`);
    }
    for (const role of [names.dev, names.owner, 'cla_app']) {
      await admin.query(`drop role if exists ${admin.escapeIdentifier(role)}`);
    }
    if (hadApp) {
      await admin.query(`alter role ${parkedAs} rename to cla_app`);
    }
    await admin.end();
  });
  return admin;
}

/** The script with the database and owner role of one test, as an administrator reaches the server. */
function scriptRunner(names: Names): Cluster['run'] {
  const { host, port, user, password: adminPassword } = adminOf();
  const environment = {
    PATH: clientPath,
    HOME: os.tmpdir(),
    LC_ALL: 'C',
    PGHOST: host,
    PGPORT: String(port),
    PGUSER: user,
    PGPASSWORD: adminPassword,
    PGDATABASE: 'postgres',
    CLA_DB_NAME: names.db,
    CLA_OWNER_ROLE: names.owner,
  };
  return (inputs = {}) => {
    const result = spawnSync(SH, [SCRIPT], { env: { ...environment, ...inputs }, input: '', encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
}

async function cluster(): Promise<Cluster> {
  const names = namesFor(randomBytes(5).toString('hex'));
  const { host, port, user, password: adminPassword } = adminOf();
  const connection = { host, port, user, password: adminPassword };
  return {
    names,
    admin: await prepare(names, connection),
    run: scriptRunner(names),
    query: async (statement, db = 'postgres', values = []) => {
      const session = new pg.Client({ ...connection, database: db });
      await session.connect();
      try {
        return (await session.query<Record<string, unknown>>(statement, values)).rows;
      } finally {
        await session.end();
      }
    },
    connectAs: async (role, secret, db) => {
      const session = new pg.Client({ host, port, user: role, password: secret, database: db });
      await session.connect();
      onTestFinished(() => session.end());
      return session;
    },
  };
}

const ROLE_FLAGS = `select rolname, rolcanlogin as login, rolsuper as super, rolcreatedb as createdb,
  rolcreaterole as createrole, rolreplication as replication, rolbypassrls as bypassrls
  from pg_roles where rolname = any($1) order by rolname`;
const LOGIN_ONLY = {
  login: true,
  super: false,
  createdb: false,
  createrole: false,
  replication: false,
  bypassrls: false,
};

/** The lines of steps of a run's output: everything before the blank line that precedes the connection strings. */
const steps = (stdout: string): string[] => (stdout.split('\n\n')[0] ?? '').split('\n').filter((line) => line !== '');

const firstRun = { CLA_OWNER_PASSWORD: OWNER_PASSWORD, CLA_APP_PASSWORD: APP_PASSWORD };

test('the names a test generates are valid for the script', () => {
  const { db, owner, dev, other } = namesFor(randomBytes(5).toString('hex'));
  for (const name of [db, owner, dev, other]) {
    expect(name).toMatch(NAME_RULE);
  }
});

/** The SQL file given to psql directly, as an operator who bypasses the shell script would, through the same client. */
function runSql(inputs: Record<string, string>): Outcome {
  const { host, port, user, password: adminPassword } = adminOf();
  const connection = client === undefined ? ['-h', host, '-p', String(port)] : [];
  const env = { PATH: clientPath, LC_ALL: 'C', PGUSER: user, PGPASSWORD: adminPassword, ...inputs };
  const sql = fs.readFileSync(path.join(ROOT, 'scripts/provision-database.sql'), 'utf8');
  const psql = client === undefined ? findOnPath('psql') : path.join(client, 'psql');
  const args = ['-X', '-q', '-w', '-v', 'ON_ERROR_STOP=1', ...connection, '-d', 'postgres'];
  const result = spawnSync(psql, args, { env, input: sql, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

realPostgresRolesOnly('the SQL file refuses bad input by itself, without relying on the shell script', async () => {
  const c = await cluster();
  const base = { ...firstRun, CLA_DB_NAME: c.names.db, CLA_OWNER_ROLE: c.names.owner };
  const dev = { CLA_TEST_ROLE: c.names.dev, CLA_TEST_PASSWORD: OWNER_PASSWORD };
  const refused: [Record<string, string>, string][] = [
    [{ CLA_DB_NAME: 'Not Valid' }, 'CLA_DB_NAME must match'],
    [{ CLA_OWNER_ROLE: 'pg_owner' }, 'CLA_OWNER_ROLE must match'],
    [{ CLA_OWNER_ROLE: 'cla_app' }, 'CLA_OWNER_ROLE must match'],
    [{ CLA_TEST_ROLE: 'cla_app', CLA_TEST_PASSWORD: OWNER_PASSWORD }, 'CLA_TEST_ROLE must match'],
    [{ CLA_APP_PASSWORD: 'short' }, 'CLA_APP_PASSWORD is shorter than 16 characters'],
    [{ CLA_OWNER_PASSWORD: 'short' }, 'CLA_OWNER_PASSWORD is shorter than 16 characters'],
    [{ ...dev, CLA_TEST_PASSWORD: 'short' }, 'CLA_TEST_PASSWORD is shorter than 16 characters'],
    [{ CLA_TEST_PASSWORD: OWNER_PASSWORD }, 'CLA_TEST_PASSWORD needs CLA_TEST_ROLE'],
    [{ ...dev, NODE_ENV: 'production' }, 'refused when NODE_ENV=production'],
  ];
  for (const [change, message] of refused) {
    const run = runSql({ ...base, ...change });
    expect([
      message,
      run.status,
      run.stderr.includes('provision-database: invalid: '),
      run.stderr.includes(message),
    ]).toEqual([message, 3, true, true]);
  }
  const databases = await c.query('select datname from pg_database where datname = any($1)', 'postgres', [
    [c.names.db, 'Not Valid'],
  ]);
  expect(databases).toEqual([]);
  const roles = await c.query('select rolname from pg_roles where rolname = any($1)', 'postgres', [
    [c.names.owner, c.names.dev, 'pg_owner'],
  ]);
  expect(roles).toEqual([]);
});

realPostgresRolesOnly(
  'the SQL file will not change the bootstrap superuser or the role the connection logs in as',
  async () => {
    const c = await cluster();
    const { user } = adminOf();
    const bootstrap = runSql({ ...firstRun, CLA_DB_NAME: c.names.db, CLA_OWNER_ROLE: user });
    expect(bootstrap.status).toBe(3);
    expect(bootstrap.stderr).toContain('conflict: refusing to change the attributes of the bootstrap superuser');
    expect(await c.query('select rolsuper from pg_roles where rolname = $1', 'postgres', [user])).toEqual([
      { rolsuper: true },
    ]);
    await c.admin.query(`create role ${c.names.owner} login superuser password '${OWNER_PASSWORD}'`);
    const login = { PGUSER: c.names.owner, PGPASSWORD: OWNER_PASSWORD };
    const asRole = runSql({ ...firstRun, CLA_DB_NAME: c.names.db, CLA_OWNER_ROLE: c.names.owner, ...login });
    expect(asRole.status).toBe(3);
    expect(asRole.stderr).toContain('conflict: refusing to change a role that this connection logs in as');
  },
);

realPostgresRolesOnly(
  'the development role creates databases and roles, has no CONNECT on the application database',
  async () => {
    const c = await cluster();
    const inputs = { ...firstRun, CLA_TEST_ROLE: c.names.dev };
    const devPassword = `dev-${randomBytes(10).toString('hex')}`;
    const production = c.run({ ...inputs, CLA_TEST_PASSWORD: devPassword, NODE_ENV: 'production' });
    expect(production.status).toBe(2);
    expect(await c.query('select 1 from pg_roles where rolname = $1', 'postgres', [c.names.dev])).toEqual([]);
    const run = c.run({ ...inputs, CLA_TEST_PASSWORD: devPassword });
    expect([run.status, run.stderr]).toEqual([0, '']);
    expect(steps(run.stdout)).toContain(`role ${c.names.dev}: created`);
    const flags = await c.query(ROLE_FLAGS, 'postgres', [[c.names.dev]]);
    expect(flags).toEqual([{ ...LOGIN_ONLY, rolname: c.names.dev, createdb: true, createrole: true }]);
    const connect = await c.query('select has_database_privilege($1, $2, $3) as can', 'postgres', [
      c.names.dev,
      c.names.db,
      'CONNECT',
    ]);
    expect(connect).toEqual([{ can: false }]);
    const session = await c.connectAs(c.names.dev, devPassword, 'postgres');
    await session.query(`create database ${c.names.other}`);
    await expect(c.connectAs(c.names.dev, devPassword, c.names.db)).rejects.toMatchObject({ code: '42501' });
  },
);

realPostgresRolesOnly(
  'the owner installs the queue tables and cla_app gets the access pg-boss needs and no more',
  async () => {
    const c = await cluster();
    c.run(firstRun);
    const owner = await c.connectAs(c.names.owner, OWNER_PASSWORD, c.names.db);
    await owner.query('create table pgboss.job (id serial primary key, name text)');
    await owner.query('create function pgboss.touch() returns integer language sql as $$ select 1 $$');
    const app = await c.connectAs('cla_app', APP_PASSWORD, c.names.db);
    await app.query("insert into pgboss.job (name) values ('a')");
    await app.query("update pgboss.job set name = 'b'");
    expect((await app.query<{ name: string }>('select name from pgboss.job')).rows).toEqual([{ name: 'b' }]);
    expect((await app.query<{ one: number }>('select pgboss.touch() as one')).rows).toEqual([{ one: 1 }]);
    await app.query('delete from pgboss.job');
    for (const denied of [
      'create table pgboss.mine (id integer)',
      'truncate pgboss.job',
      'create table public.mine (id integer)',
    ]) {
      await expect(app.query(denied)).rejects.toMatchObject({ code: '42501' });
    }
  },
);

realPostgresRolesOnly(
  'after the migrations as the owner the runtime role holds the grants of migration 001 and no more',
  async () => {
    const c = await cluster();
    c.run(firstRun);
    const { host, port } = adminOf();
    const owner = createPgDatabase({
      connectionString: `postgres://${c.names.owner}:${OWNER_PASSWORD}@${host}:${port}/${c.names.db}`,
      onError: console.error,
    });
    onTestFinished(() => owner.destroy());
    expect(await migrate(owner, await loadMigrationFiles(MIGRATIONS_DIRECTORY))).toContain('001_initial.sql');
    const app = await c.connectAs('cla_app', APP_PASSWORD, c.names.db);
    const owned = await app.query<{ n: number }>(
      "select count(*)::int as n from pg_tables where schemaname = 'public' and tableowner = 'cla_app'",
    );
    expect(owned.rows).toEqual([{ n: 0 }]);
    await app.query("insert into users (github_id, login) values (333, 'new-user')");
    await app.query("insert into audit_log (action, actor_github_id) values ('cla.signed', 333)");
    const denied = [
      'delete from audit_log',
      "update audit_log set action = 'x.y'",
      'create table not_allowed (id integer)',
    ];
    for (const statement of [...denied, 'select * from schema_migrations', 'truncate signer_pii']) {
      await expect(app.query(statement)).rejects.toMatchObject({ code: '42501' });
    }
    const logged = await app.query<{ n: number }>('select count(*)::int as n from audit_log');
    expect(logged.rows).toEqual([{ n: 1 }]);
  },
);

realPostgresRolesOnly(
  'the queue step of the migrations runs as the owner in the provisioned schema and a rerun changes nothing',
  async () => {
    const c = await cluster();
    c.run(firstRun);
    const { host, port } = adminOf();
    const connectionString = `postgres://${c.names.owner}:${OWNER_PASSWORD}@${host}:${port}/${c.names.db}`;
    const owner = createPgDatabase({ connectionString, onError: console.error });
    onTestFinished(() => owner.destroy());
    await migrate(owner, await loadMigrationFiles(MIGRATIONS_DIRECTORY));
    const queues = await migrateJobQueues({ connectionString, db: owner, onError: console.error });
    expect(queues.grants).toBe('granted');
    const app = await c.connectAs('cla_app', APP_PASSWORD, c.names.db);
    const queueRows = await app.query<{ n: number }>('select count(*)::int as n from pgboss.queue');
    expect(queueRows.rows[0]?.n).toBeGreaterThan(10);
    const tables = await c.query(
      "select count(distinct tableowner)::int as owners, min(tableowner) as owner from pg_tables where schemaname = 'pgboss'",
      c.names.db,
    );
    expect(tables).toEqual([{ owners: 1, owner: c.names.owner }]);
    const rerun = c.run();
    expect(rerun.status).toBe(0);
    expect(steps(rerun.stdout).every((line) => line.endsWith(': unchanged'))).toBe(true);
  },
);
