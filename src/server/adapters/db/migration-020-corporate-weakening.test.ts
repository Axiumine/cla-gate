// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { expect, test } from 'vitest';
import { loadMigrationFiles } from './migration-files.ts';
import { migrate } from './migrator.ts';
import type { Database } from './schema.ts';
import { emptyTestDatabase, ensureRuntimeRole, MIGRATIONS_DIRECTORY } from './test-support.ts';

// Migration 020 (E21-S01) weakens nothing the earlier migrations built. The catalogue is read just before and just after it:
// every trigger, constraint, index and function that existed is still there as it was (the erasure function excepted: its
// properties are checked instead, and its behaviour by the erasure tests), the runtime role holds on every earlier table and
// column exactly the privileges it held, and what the migration adds is a list written out here.

const MIGRATION = '020_corporate_cla.sql';
const NEW_TABLES = ['corporate_agreement_pii', 'corporate_agreements', 'corporate_approval_pii', 'corporate_approvals'];

type Catalogue = ReadonlyMap<string, string>;

/** Reads a query of two columns, key and value, into a map. */
async function read(
  db: Kysely<Database>,
  query: ReturnType<typeof sql<{ key: string; value: string }>>,
): Promise<Catalogue> {
  const { rows } = await query.execute(db);
  return new Map(rows.map((row) => [row.key, row.value]));
}

/** The triggers, constraints, indexes and functions of the `public` schema. */
async function structure(db: Kysely<Database>) {
  const triggers = await read(
    db,
    sql<{ key: string; value: string }>`
      select c.relname || '.' || t.tgname as key, pg_get_triggerdef(t.oid) || ' enabled=' || t.tgenabled::text as value
      from pg_trigger as t join pg_class as c on c.oid = t.tgrelid
      where c.relnamespace = 'public'::regnamespace and not t.tgisinternal`,
  );
  const constraints = await read(
    db,
    sql<{ key: string; value: string }>`
      select c.relname || '.' || k.conname as key, pg_get_constraintdef(k.oid) as value
      from pg_constraint as k join pg_class as c on c.oid = k.conrelid
      where c.relnamespace = 'public'::regnamespace`,
  );
  const indexes = await read(
    db,
    sql<{ key: string; value: string }>`
      select tablename || '.' || indexname as key, indexdef as value from pg_indexes where schemaname = 'public'`,
  );
  const functions = await read(
    db,
    sql<{ key: string; value: string }>`
      select p.oid::regprocedure::text as key, pg_get_functiondef(p.oid) as value
      from pg_proc as p where p.pronamespace = 'public'::regnamespace`,
  );
  return { triggers, constraints, indexes, functions };
}

/** What the runtime role and PUBLIC may do with the tables, columns and functions of the `public` schema. */
async function privileges(db: Kysely<Database>) {
  const tablePrivileges = await read(
    db,
    sql<{ key: string; value: string }>`
      select c.relname || '.' || p as key, has_table_privilege('cla_app', c.oid, p)::text as value
      from pg_class as c
      cross join unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) as p
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'`,
  );
  const columnPrivileges = await read(
    db,
    sql<{ key: string; value: string }>`
      select c.relname || '.' || a.attname || '.' || p as key, has_column_privilege('cla_app', c.oid, a.attnum, p)::text as value
      from pg_class as c
      join pg_attribute as a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      cross join unnest(array['select', 'insert', 'update', 'references']) as p
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'`,
  );
  const functionPrivileges = await read(
    db,
    sql<{ key: string; value: string }>`
      select p.oid::regprocedure::text || '.' || r as key,
             has_function_privilege(r, p.oid, 'execute')::text as value
      from pg_proc as p cross join unnest(array['public', 'cla_app']) as r
      where p.pronamespace = 'public'::regnamespace`,
  );
  return { tablePrivileges, columnPrivileges, functionPrivileges };
}

/** The catalogue of the `public` schema, one map per kind of object. */
async function catalogue(db: Kysely<Database>) {
  return { ...(await structure(db)), ...(await privileges(db)) };
}

/** What differs between two catalogues of one kind: the keys that vanished, the keys whose value changed, the keys that were added. */
function compare(before: Catalogue, after: Catalogue) {
  const keys = (names: readonly string[]) => names.toSorted((a, b) => a.localeCompare(b));
  return {
    removed: keys([...before.keys()].filter((key) => !after.has(key))),
    changed: keys([...before.keys()].filter((key) => after.has(key) && after.get(key) !== before.get(key))),
    added: keys([...after.keys()].filter((key) => !before.has(key))),
  };
}

/** The catalogue just before the migration and just after it, read once for the tests of this file. */
function aroundTheMigration() {
  around ??= readAroundTheMigration();
  return around;
}

let around: ReturnType<typeof readAroundTheMigration> | undefined;

async function readAroundTheMigration() {
  const { db } = await emptyTestDatabase();
  await ensureRuntimeRole(db);
  const files = await loadMigrationFiles(MIGRATIONS_DIRECTORY);
  await migrate(
    db,
    files.filter((file) => file.name < MIGRATION),
  );
  const before = await catalogue(db);
  await migrate(
    db,
    files.filter((file) => file.name <= MIGRATION),
  );
  return { before, after: await catalogue(db) };
}

const NEW_TRIGGERS = [
  'corporate_agreement_pii.corporate_agreement_pii_guard_insert',
  'corporate_agreements.corporate_agreements_guard_insert',
  'corporate_agreements.corporate_agreements_immutable',
  'corporate_agreements.corporate_agreements_no_truncate',
  'corporate_approval_pii.corporate_approval_pii_guard_insert',
  'corporate_approvals.corporate_approvals_guard_insert',
  'corporate_approvals.corporate_approvals_guard_update',
  'corporate_approvals.corporate_approvals_no_delete',
  'corporate_approvals.corporate_approvals_no_truncate',
  'repositories.repositories_guard_corporate_document',
];

test('every trigger that existed is still there, enabled and unchanged, and the migration adds the ten that are listed here', async () => {
  const { before, after } = await aroundTheMigration();
  expect([...before.triggers.keys()]).toEqual(
    expect.arrayContaining([
      'signatures.signatures_guard_update',
      'signatures.signatures_no_delete',
      'signatures.signatures_no_truncate',
      'cla_versions.cla_versions_immutable',
      'audit_log.audit_log_immutable',
      'signer_pii.signer_pii_guard_insert',
    ]),
  );
  expect(compare(before.triggers, after.triggers)).toEqual({ removed: [], changed: [], added: NEW_TRIGGERS });
});

test('every constraint and index that existed is unchanged; the migration adds constraints to its tables and one foreign key to repositories', async () => {
  const { before, after } = await aroundTheMigration();
  const constraints = compare(before.constraints, after.constraints);
  expect([constraints.removed, constraints.changed]).toEqual([[], []]);
  expect(constraints.added.filter((name) => !name.startsWith('corporate_'))).toEqual([
    'repositories.repositories_corporate_document_fk',
  ]);
  const indexes = compare(before.indexes, after.indexes);
  expect([indexes.removed, indexes.changed]).toEqual([[], []]);
  expect(indexes.added.every((name) => name.startsWith('corporate_'))).toBe(true);
});

test('every function that existed is unchanged except erase_signer_pii, which keeps its arguments, SECURITY DEFINER, pinned search_path and owner', async () => {
  const { before, after } = await aroundTheMigration();
  const functions = compare(before.functions, after.functions);
  expect(functions.removed).toEqual([]);
  expect(functions.changed).toEqual(['erase_signer_pii(bigint,bigint,bigint)']);
  expect(functions.added).toEqual([
    'corporate_agreement_pii_guard_insert()',
    'corporate_agreements_guard_insert()',
    'corporate_approval_pii_guard_insert()',
    'corporate_approvals_guard_insert()',
    'corporate_approvals_guard_update()',
    'repositories_guard_corporate_document()',
  ]);
  const erase = after.functions.get('erase_signer_pii(bigint,bigint,bigint)') ?? '';
  expect(erase).toMatch(/SECURITY DEFINER/u);
  expect(erase).toMatch(/SET search_path TO/u);
});

test('the privileges of the runtime role and of PUBLIC on every earlier table, column and function are exactly what they were', async () => {
  const { before, after } = await aroundTheMigration();
  expect(before.tablePrivileges.size).toBeGreaterThan(50);
  const same = (grants: Catalogue, now: Catalogue) => {
    const { removed, changed } = compare(grants, now);
    return [...removed, ...changed];
  };
  expect(same(before.tablePrivileges, after.tablePrivileges)).toEqual([]);
  expect(same(before.columnPrivileges, after.columnPrivileges)).toEqual([]);
  expect(same(before.functionPrivileges, after.functionPrivileges)).toEqual([]);
  expect(after.functionPrivileges.get('erase_signer_pii(bigint,bigint,bigint).public')).toBe('false');
  expect(after.functionPrivileges.get('erase_signer_pii(bigint,bigint,bigint).cla_app')).toBe('true');
});

test('what the migration adds in the way of privileges is on its four tables, on the new column of repositories and on its new functions only', async () => {
  const { before, after } = await aroundTheMigration();
  const tables = compare(before.tablePrivileges, after.tablePrivileges).added;
  expect(tables.every((name) => NEW_TABLES.includes(name.split('.')[0] ?? ''))).toBe(true);
  const columns = compare(before.columnPrivileges, after.columnPrivileges).added;
  expect(columns.filter((name) => !NEW_TABLES.includes(name.split('.')[0] ?? ''))).toEqual([
    'repositories.corporate_document_id.insert',
    'repositories.corporate_document_id.references',
    'repositories.corporate_document_id.select',
    'repositories.corporate_document_id.update',
  ]);
  expect(after.columnPrivileges.get('repositories.corporate_document_id.update')).toBe(
    after.tablePrivileges.get('repositories.update'),
  );
});
