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
import { realPostgresRolesOnly, requireTestDatabaseUrl } from './test-support.ts';

// E19-S03: scripts/provision-database.sh against a real server, part one: what a run leaves behind and how a second run
// and a conflict behave (part two: provision-database-access.test.ts, which repeats the harness below because a test file
// cannot import another). Roles are cluster-wide, so these tests run only with CLA_ROLE_TESTS=1, which the CI `postgres` job
// sets against its own disposable container. Every test uses a database and an owner role of its own name; `cla_app` is
// fixed by migration 001 and used by the rest of the suite, so each test parks it under another name first and puts it
// back afterwards, which also lets a test see it created.
//
// The client: with CLA_PG_CONTAINER set (the CI job does), psql runs inside that container through a stub on the PATH, so
// the runner needs no PostgreSQL client and the administrator connects over the socket, as the first boot of the compose
// stack does. Without it the host's psql 15 or later connects over TCP with the administrator's password.

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

realPostgresRolesOnly('a first run creates everything and leaves the end state of the story', async () => {
  const c = await cluster();
  const run = c.run(firstRun);
  expect([run.status, run.stderr]).toEqual([0, '']);
  expect(steps(run.stdout)).toEqual([
    `role ${c.names.owner}: created`,
    'role cla_app: created',
    `role ${c.names.owner} password: set`,
    'role cla_app password: set',
    'role membership: unchanged',
    `database ${c.names.db}: created`,
    `database ${c.names.db} access: updated`,
    'schema public: unchanged',
    'schema pgboss: created',
    'schema pgboss access: updated',
  ]);
  expect(await c.query(ROLE_FLAGS, 'postgres', [[c.names.owner, 'cla_app']])).toEqual([
    { rolname: 'cla_app', ...LOGIN_ONLY },
    { rolname: c.names.owner, ...LOGIN_ONLY },
  ]);
  const [facts] = await c.query(
    `select pg_get_userbyid(datdba) as owner, pg_encoding_to_char(encoding) as encoding,
       has_database_privilege('cla_app', $1, 'CONNECT') as app_connect,
       has_database_privilege('cla_app', $1, 'CREATE') as app_create,
       has_database_privilege('cla_app', $1, 'TEMPORARY') as app_temp,
       (select count(*)::int from aclexplode(coalesce(datacl, acldefault('d', datdba))) a where a.grantee = 0) as public_privileges,
       (select count(*)::int from pg_auth_members a join pg_roles r on r.oid = a.roleid join pg_roles m on m.oid = a.member
         where r.rolname in ('cla_app', $2) and m.rolname in ('cla_app', $2)) as memberships
     from pg_database where datname = $1`,
    'postgres',
    [c.names.db, c.names.owner],
  );
  expect(facts).toEqual({
    owner: c.names.owner,
    encoding: 'UTF8',
    app_connect: true,
    app_create: false,
    app_temp: false,
    public_privileges: 0,
    memberships: 0,
  });
});

realPostgresRolesOnly(
  'inside the database nobody but the owner creates, cla_app owns nothing, defaults are pgboss only',
  async () => {
    const c = await cluster();
    c.run(firstRun);
    const [facts] = await c.query(
      `select pg_get_userbyid(nspowner) as pgboss_owner,
       has_schema_privilege('cla_app', 'public', 'CREATE') as app_creates_in_public,
       (select count(*)::int from pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
         where n.nspname = 'public' and a.grantee = 0 and a.privilege_type = 'CREATE') as public_creates,
       has_schema_privilege('cla_app', 'pgboss', 'USAGE') as app_uses_pgboss,
       has_schema_privilege('cla_app', 'pgboss', 'CREATE') as app_creates_in_pgboss,
       (select count(*)::int from pg_shdepend where refclassid = 'pg_authid'::regclass and deptype = 'o'
         and refobjid = (select oid from pg_roles where rolname = 'cla_app')) as owned,
       (select array_agg(distinct defaclnamespace::regnamespace::text) from pg_default_acl) as default_schemas
     from pg_namespace where nspname = 'pgboss'`,
      c.names.db,
    );
    expect(facts).toEqual({
      pgboss_owner: c.names.owner,
      app_creates_in_public: false,
      public_creates: 0,
      app_uses_pgboss: true,
      app_creates_in_pgboss: false,
      owned: 0,
      default_schemas: ['pgboss'],
    });
  },
);

/** Everything a second run is meant to leave alone: roles, memberships, the database, its schemas and their ACLs. */
interface Snapshot {
  readonly roles: Record<string, unknown>[];
  readonly members: Record<string, unknown>[];
  readonly database: Record<string, unknown>[];
  readonly inside: Record<string, unknown>[][];
}

async function snapshot(c: Cluster): Promise<Snapshot> {
  const both = [[c.names.owner, 'cla_app']];
  const inside = [
    "select nspname, pg_get_userbyid(nspowner) as owner, nspacl::text as acl from pg_namespace where nspname in ('public', 'pgboss') order by 1",
    'select defaclrole::regrole::text as role, defaclnamespace::regnamespace::text as schema, defaclobjtype as kind, defaclacl::text as acl from pg_default_acl order by 1, 2, 3',
  ];
  return {
    roles: await c.query(ROLE_FLAGS, 'postgres', both),
    members: await c.query(
      `select r.rolname as role, m.rolname as member from pg_auth_members a join pg_roles r on r.oid = a.roleid
       join pg_roles m on m.oid = a.member where r.rolname = any($1) or m.rolname = any($1) order by 1, 2`,
      'postgres',
      both,
    ),
    database: await c.query(
      'select datname, pg_get_userbyid(datdba) as owner, pg_encoding_to_char(encoding) as encoding, datacl::text as acl from pg_database where datname = $1',
      'postgres',
      [c.names.db],
    ),
    inside: await Promise.all(inside.map((statement) => c.query(statement, c.names.db))),
  };
}

realPostgresRolesOnly('a second run says unchanged for every step, exits 0 and changes nothing', async () => {
  const c = await cluster();
  expect(c.run(firstRun).status).toBe(0);
  const before = await snapshot(c);
  const second = c.run();
  expect([second.status, second.stderr]).toEqual([0, '']);
  expect(steps(second.stdout)).toEqual([
    `role ${c.names.owner}: unchanged`,
    'role cla_app: unchanged',
    'role membership: unchanged',
    `database ${c.names.db}: unchanged`,
    `database ${c.names.db} access: unchanged`,
    'schema public: unchanged',
    'schema pgboss: unchanged',
    'schema pgboss access: unchanged',
  ]);
  expect(await snapshot(c)).toEqual(before);
  expect(c.run(firstRun).status).toBe(0);
  expect(await snapshot(c)).toEqual(before);
});

realPostgresRolesOnly(
  'a password is set on creation, re-set whenever one is supplied, and kept when none is',
  async () => {
    const c = await cluster();
    const { owner, db } = c.names;
    c.run(firstRun);
    await (await c.connectAs(owner, OWNER_PASSWORD, db)).query('select 1');
    expect(steps(c.run().stdout).join('\n')).not.toContain('password');
    await (await c.connectAs(owner, OWNER_PASSWORD, db)).query('select 1');
    const renewed = `renewed-${randomBytes(10).toString('hex')}`;
    expect(steps(c.run({ CLA_OWNER_PASSWORD: renewed }).stdout)).toContain(`role ${owner} password: set`);
    await (await c.connectAs(owner, renewed, db)).query('select 1');
    await expect(c.connectAs(owner, OWNER_PASSWORD, db)).rejects.toMatchObject({ code: '28P01' });
    await (await c.connectAs('cla_app', APP_PASSWORD, db)).query('select 1');
  },
);

realPostgresRolesOnly('a role with the wrong attributes is corrected, a superuser cla_app included', async () => {
  const c = await cluster();
  expect(c.run(firstRun).status).toBe(0);
  await c.admin.query('alter role cla_app superuser createdb createrole replication bypassrls');
  await c.admin.query(`alter role ${c.names.owner} nologin createdb`);
  const run = c.run();
  expect(run.status).toBe(0);
  expect(steps(run.stdout).slice(0, 2)).toEqual([`role ${c.names.owner}: updated`, 'role cla_app: updated']);
  expect(await c.query(ROLE_FLAGS, 'postgres', [[c.names.owner, 'cla_app']])).toEqual([
    { rolname: 'cla_app', ...LOGIN_ONLY },
    { rolname: c.names.owner, ...LOGIN_ONLY },
  ]);
});

realPostgresRolesOnly(
  'a membership between the two roles is removed and a database that PUBLIC can use is closed',
  async () => {
    const c = await cluster();
    await c.admin.query(`create role ${c.names.owner} login`);
    await c.admin.query('create role cla_app login');
    await c.admin.query(`grant cla_app to ${c.names.owner}`);
    await c.admin.query(`create database ${c.names.db} owner ${c.names.owner}`);
    await c.query('grant create on schema public to public', c.names.db);
    const run = c.run();
    expect([run.status, run.stderr]).toEqual([0, '']);
    expect(steps(run.stdout)).toEqual(
      expect.arrayContaining([
        'role membership: updated',
        `database ${c.names.db} access: updated`,
        'schema public: updated',
      ]),
    );
    expect((await snapshot(c)).members).toEqual([]);
    const [open] = await c.query(
      "select count(*)::int as n from pg_namespace n, aclexplode(n.nspacl) a where n.nspname = 'public' and a.grantee = 0 and a.privilege_type = 'CREATE'",
      c.names.db,
    );
    expect(open).toEqual({ n: 0 });
  },
);

realPostgresRolesOnly('a creation without a password source exits 2 and creates nothing, for each role', async () => {
  const c = await cluster();
  const noOwner = c.run({ CLA_APP_PASSWORD: APP_PASSWORD });
  expect(noOwner.status).toBe(2);
  expect(noOwner.stderr).toContain(`invalid: role ${c.names.owner} does not exist and no password was given`);
  const noApp = c.run({ CLA_OWNER_PASSWORD: OWNER_PASSWORD });
  expect(noApp.status).toBe(2);
  expect(noApp.stderr).toContain('invalid: role cla_app does not exist and no password was given');
  const roles = await c.query('select rolname from pg_roles where rolname = any($1)', 'postgres', [
    [c.names.owner, 'cla_app'],
  ]);
  expect(roles).toEqual([]);
  expect(await c.query('select datname from pg_database where datname = $1', 'postgres', [c.names.db])).toEqual([]);
});

realPostgresRolesOnly(
  'a database with another owner is refused with exit 3, left as it was, and nothing is dropped',
  async () => {
    const c = await cluster();
    await c.admin.query(`create database ${c.names.db} owner ${adminOf().user}`);
    const owners = (): Promise<Record<string, unknown>[]> =>
      c.query('select datname, pg_get_userbyid(datdba) as owner from pg_database where datname = $1', 'postgres', [
        c.names.db,
      ]);
    const before = await owners();
    const run = c.run(firstRun);
    expect(run.status).toBe(3);
    expect(run.stderr).toContain('provision-database: conflict: refusing to change the owner of an existing database');
    expect(await owners()).toEqual(before);
    expect(await c.query('select 1 from pg_roles where rolname = $1', 'postgres', [c.names.owner])).toEqual([]);
  },
);

realPostgresRolesOnly('objects owned by cla_app are refused with exit 3 and nothing is reassigned', async () => {
  const c = await cluster();
  expect(c.run(firstRun).status).toBe(0);
  await c.query('create table stray (id integer); alter table stray owner to cla_app', c.names.db);
  const run = c.run();
  expect(run.status).toBe(3);
  expect(run.stderr).toContain('provision-database: conflict: cla_app owns objects');
  expect(await c.query("select tableowner from pg_tables where tablename = 'stray'", c.names.db)).toEqual([
    { tableowner: 'cla_app' },
  ]);
});

realPostgresRolesOnly('a pgboss schema that another role owns is refused with exit 3', async () => {
  const c = await cluster();
  await c.admin.query(`create role ${c.names.owner} login password '${OWNER_PASSWORD}'`);
  await c.admin.query(`create database ${c.names.db} owner ${c.names.owner}`);
  await c.query('create schema pgboss', c.names.db);
  const run = c.run({ CLA_APP_PASSWORD: APP_PASSWORD });
  expect(run.status).toBe(3);
  expect(run.stderr).toContain(
    'provision-database: conflict: refusing to change the owner of the existing schema pgboss',
  );
});

realPostgresRolesOnly('hostile names are refused with exit 2 before anything is created', async () => {
  const c = await cluster();
  const hostile = 'x"; drop database postgres; --';
  for (const variable of ['CLA_DB_NAME', 'CLA_OWNER_ROLE', 'CLA_TEST_ROLE']) {
    const run = c.run({ ...firstRun, CLA_TEST_PASSWORD: OWNER_PASSWORD, [variable]: hostile });
    expect([variable, run.status, run.stderr.includes(`${variable} must match`)]).toEqual([variable, 2, true]);
  }
  expect(await c.query("select datname from pg_database where datname = 'postgres'")).toEqual([
    { datname: 'postgres' },
  ]);
  const roles = await c.query('select rolname from pg_roles where rolname = any($1)', 'postgres', [
    [c.names.owner, 'cla_app'],
  ]);
  expect(roles).toEqual([]);
});

realPostgresRolesOnly('a connection that fails exits 4 and creates nothing', async () => {
  const c = await cluster();
  const run = c.run({ ...firstRun, PGUSER: `no_such_admin_${randomBytes(4).toString('hex')}` });
  expect(run.status).toBe(4);
  expect(run.stdout).toBe('');
  expect(await c.query('select 1 from pg_roles where rolname = $1', 'postgres', [c.names.owner])).toEqual([]);
});
