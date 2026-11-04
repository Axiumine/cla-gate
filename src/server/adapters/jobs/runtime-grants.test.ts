// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, type KyselyPlugin, type RawBuilder, RawNode, sql } from 'kysely';
import { expect, onTestFinished, test } from 'vitest';
import { openPgliteDatabase } from '../db/pglite.ts';
import type { Database } from '../db/schema.ts';
import {
  backendPid,
  emptyTestDatabase,
  ensureRuntimeRole,
  realPostgresOnly,
  waitUntilBlocked,
  withConnections,
} from '../db/test-support.ts';
import { grantRuntimeAccess } from './runtime-grants.ts';

// The grants of the runtime role on a stand-in for the pgboss schema: PGlite enforces privileges like PostgreSQL does, and
// pg-boss itself is not needed to see what is granted. The real schema is checked in queue-real.test.ts.

/** A schema with the kinds of object pg-boss has: a table, a sequence and a function, owned by the connecting role. */
async function standInSchema(db: Kysely<Database>): Promise<void> {
  await sql`drop schema if exists pgboss cascade`.execute(db);
  await sql`create schema pgboss`.execute(db);
  await sql`create table pgboss.job (id integer primary key, name text not null)`.execute(db);
  await sql`create table pgboss.queue (name text primary key)`.execute(db);
  await sql`create sequence pgboss.counter`.execute(db);
  await sql`create function pgboss.job_now() returns timestamptz language sql as 'select now()'`.execute(db);
}

/** Whether the privilege test `check` (an expression such as `has_table_privilege(...)`) holds. */
async function can(db: Kysely<Database>, check: RawBuilder<boolean>): Promise<boolean> {
  const { rows } = await sql<{ ok: boolean }>`select ${check} as ok`.execute(db);
  return rows[0]?.ok === true;
}

test('without the runtime role it does nothing and says so', async () => {
  // a fresh PGlite: on a real server the role is cluster-wide and other tests may have created it
  const db = await openPgliteDatabase();
  onTestFinished(async () => {
    await db.destroy();
  });
  await standInSchema(db);
  expect(await grantRuntimeAccess(db)).toBe('skipped');
});

test('the runtime role gets use of the schema, DML on its tables, its sequences and its functions', async () => {
  const { db } = await emptyTestDatabase();
  await ensureRuntimeRole(db);
  await standInSchema(db);
  expect(await grantRuntimeAccess(db)).toBe('granted');
  const privileges = await sql<Record<string, boolean>>`
    select
      has_schema_privilege('cla_app', 'pgboss', 'USAGE') as usage,
      bool_and(has_table_privilege('cla_app', c.oid, 'SELECT')
        and has_table_privilege('cla_app', c.oid, 'INSERT')
        and has_table_privilege('cla_app', c.oid, 'UPDATE')
        and has_table_privilege('cla_app', c.oid, 'DELETE')) as dml,
      has_sequence_privilege('cla_app', 'pgboss.counter', 'USAGE') as sequence,
      has_function_privilege('cla_app', 'pgboss.job_now()', 'EXECUTE') as fn
    from pg_class c where c.relnamespace = 'pgboss'::regnamespace and c.relkind = 'r'
    group by 1, 3, 4`.execute(db);
  expect(privileges.rows).toEqual([{ usage: true, dml: true, sequence: true, fn: true }]);
});

test.each([
  ['CREATE on the schema', sql<boolean>`has_schema_privilege('cla_app', 'pgboss', 'CREATE')`],
  ['TRUNCATE of a table', sql<boolean>`has_table_privilege('cla_app', 'pgboss.job', 'TRUNCATE')`],
  ['REFERENCES on a table', sql<boolean>`has_table_privilege('cla_app', 'pgboss.job', 'REFERENCES')`],
  ['TRIGGER on a table', sql<boolean>`has_table_privilege('cla_app', 'pgboss.job', 'TRIGGER')`],
  [
    'ownership of a table',
    sql<boolean>`pg_has_role('cla_app', (select relowner from pg_class where oid = 'pgboss.job'::regclass), 'USAGE')`,
  ],
])('the runtime role gets no %s', async (_privilege, check) => {
  const { db } = await emptyTestDatabase();
  await ensureRuntimeRole(db);
  await standInSchema(db);
  await grantRuntimeAccess(db);
  expect(await can(db, check)).toBe(false);
});

test('what the owner creates in the schema afterwards is granted at once, and what it creates elsewhere is not', async () => {
  const { db } = await emptyTestDatabase();
  await ensureRuntimeRole(db);
  await standInSchema(db);
  await grantRuntimeAccess(db);
  await sql`create table pgboss.later (id integer)`.execute(db);
  await sql`create sequence pgboss.later_seq`.execute(db);
  await sql`create function pgboss.later_fn() returns integer language sql as 'select 1'`.execute(db);
  await sql`create table public.elsewhere (id integer)`.execute(db);
  expect(await can(db, sql<boolean>`has_table_privilege('cla_app', 'pgboss.later', 'DELETE')`)).toBe(true);
  expect(await can(db, sql<boolean>`has_sequence_privilege('cla_app', 'pgboss.later_seq', 'USAGE')`)).toBe(true);
  expect(await can(db, sql<boolean>`has_function_privilege('cla_app', 'pgboss.later_fn()', 'EXECUTE')`)).toBe(true);
  expect(await can(db, sql<boolean>`has_table_privilege('cla_app', 'public.elsewhere', 'SELECT')`)).toBe(false);
});

test('running it again changes nothing and fails nothing', async () => {
  const { db } = await emptyTestDatabase();
  await ensureRuntimeRole(db);
  await standInSchema(db);
  expect(await grantRuntimeAccess(db)).toBe('granted');
  expect(await grantRuntimeAccess(db)).toBe('granted');
  expect(await can(db, sql<boolean>`has_table_privilege('cla_app', 'pgboss.job', 'UPDATE')`)).toBe(true);
});

test('a database without the pgboss schema fails, and no grant is left half made', async () => {
  const { db } = await emptyTestDatabase();
  await ensureRuntimeRole(db);
  await sql`drop schema if exists pgboss cascade`.execute(db);
  await expect(grantRuntimeAccess(db)).rejects.toThrow('pgboss');
});

/** The raw statements a connection runs, as text with `?` for each parameter, and the parameters, in the order they were sent. */
function recorder(): { readonly plugin: KyselyPlugin; readonly statements: string[]; readonly parameters: unknown[] } {
  const statements: string[] = [];
  const parameters: unknown[] = [];
  const plugin: KyselyPlugin = {
    transformQuery: ({ node }) => {
      if (RawNode.is(node)) {
        statements.push(node.sqlFragments.join('?'));
        parameters.push(...node.parameters.map((parameter) => ('value' in parameter ? parameter.value : undefined)));
      }
      return node;
    },
    transformResult: ({ result }) => Promise.resolve(result),
  };
  return { plugin, statements, parameters };
}

test('the first statement of the grants takes the transaction-level advisory lock, before any grant (E19-S12)', async () => {
  const { db } = await emptyTestDatabase();
  await ensureRuntimeRole(db);
  await standInSchema(db);
  const { plugin, statements, parameters } = recorder();
  await grantRuntimeAccess(db.withPlugin(plugin));
  const lock = statements.findIndex((statement) => statement.includes('pg_advisory_xact_lock'));
  const firstGrant = statements.findIndex((statement) => statement.includes('grant '));
  expect(lock).toBeGreaterThanOrEqual(0);
  expect(lock).toBeLessThan(firstGrant);
  expect(parameters).toContain('migrate:runtime-grants');
});

// PGlite has one session, so two runs can never overlap there. A real server shows both halves: a run waits for the lock
// that another session holds, and many runs at once all succeed.
realPostgresOnly(
  'a run waits while another session holds the lock of the grants, and goes on when it is released',
  async () => {
    const { db: setup } = await emptyTestDatabase();
    await ensureRuntimeRole(setup);
    await standInSchema(setup);
    const sessions = withConnections(3);
    const [holder, runner, observer] = [sessions.get(0), sessions.get(1), sessions.get(2)];
    const pid = await backendPid(runner);
    let finished = false;
    let running: Promise<'granted' | 'skipped'> | undefined;
    await holder.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtextextended('migrate:runtime-grants', 0))`.execute(trx);
      running = grantRuntimeAccess(runner).finally(() => {
        finished = true;
      });
      await waitUntilBlocked(observer, pid);
      expect(finished).toBe(false);
    });
    expect(await running).toBe('granted');
    expect(finished).toBe(true);
  },
);

realPostgresOnly('several runs at once all succeed and leave the grants in place', async () => {
  const { db: setup } = await emptyTestDatabase();
  await ensureRuntimeRole(setup);
  await standInSchema(setup);
  const sessions = withConnections(6);
  const runs = Array.from({ length: 6 }, (_, index) => grantRuntimeAccess(sessions.get(index)));
  expect(await Promise.all(runs)).toEqual(Array.from({ length: 6 }, () => 'granted'));
  expect(await can(setup, sql<boolean>`has_table_privilege('cla_app', 'pgboss.job', 'UPDATE')`)).toBe(true);
});
