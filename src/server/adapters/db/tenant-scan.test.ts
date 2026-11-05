// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { TENANT_MODULES } from './tenant-registry/test-support.ts';
import {
  exportedFunctions,
  isServerSource,
  queryGaps,
  scanProblems,
  serverSources,
  tenantTableUses,
} from './tenant-scan/test-support.ts';

// The source scan itself (E11-S06): what it finds in a piece of source, shown on made-up sources. What it finds in the
// server is tenant-modules.test.ts.

const use = (table: string, via: string) => ({ table, via });

/** A `sql` template with a part to fill in, built from pieces so that no string of this file holds the characters that start one. */
const HOLE = ['$', '{id}'].join('');

test.each([
  ['a select', "db.selectFrom('repositories').selectAll()", [use('repositories', 'selectFrom')]],
  ['an insert', "trx.insertInto('signatures').values(row)", [use('signatures', 'insertInto')]],
  ['an update', "db.updateTable('cla_documents').set(x)", [use('cla_documents', 'updateTable')]],
  ['a delete', "db.deleteFrom('allowlist_entries')", [use('allowlist_entries', 'deleteFrom')]],
  ['an alias', "db.selectFrom('repositories as r')", [use('repositories', 'selectFrom')]],
  ['a template literal', 'db.selectFrom(`pr_evaluations`)', [use('pr_evaluations', 'selectFrom')]],
  ['an inner join', "q.innerJoin('commit_overrides', 'a', 'b')", [use('commit_overrides', 'innerJoin')]],
  ['a left join', "q.leftJoin('signer_pii', 'a', 'b')", [use('signer_pii', 'leftJoin')]],
  ['a right join', "q.rightJoin('cla_versions', 'a', 'b')", [use('cla_versions', 'rightJoin')]],
  ['a full join', "q.fullJoin('audit_log', 'a', 'b')", [use('audit_log', 'fullJoin')]],
  ['a cross join', "q.crossJoin('repositories')", [use('repositories', 'crossJoin')]],
  [
    'a subquery',
    "db.selectFrom('users').where((eb) => eb.exists(eb.selectFrom('signatures').select('id')))",
    [use('signatures', 'selectFrom')],
  ],
  [
    'a corporate table: a select',
    "db.selectFrom('corporate_agreements').selectAll()",
    [use('corporate_agreements', 'selectFrom')],
  ],
  [
    'a corporate table: an insert',
    "trx.insertInto('corporate_approvals').values(row)",
    [use('corporate_approvals', 'insertInto')],
  ],
  [
    'a corporate table: a join',
    "q.innerJoin('corporate_approval_pii', 'a', 'b')",
    [use('corporate_approval_pii', 'innerJoin')],
  ],
  ['a corporate table: raw sql', 'sql`select 1 from corporate_agreement_pii`', [use('corporate_agreement_pii', 'sql')]],
  ['a table that is not a tenant table', "db.selectFrom('users').selectAll()", []],
  ['a table named by a variable', 'db.selectFrom(name)', [use('?', 'selectFrom')]],
  ['a table named by a template with a part to fill in', `db.deleteFrom(\`${HOLE}\`)`, [use('?', 'deleteFrom')]],
  ['a call with no argument', 'db.selectFrom()', [use('?', 'selectFrom')]],
  ['a method that names no table', "db.selectFrom('users').where('signatures', '=', 1)", []],
  ['a bare function of that name', "selectFrom('signatures')", []],
  [
    'a comment and a string that look like a call',
    "// db.selectFrom('signatures')\nconst s = \"db.selectFrom('signatures')\";",
    [],
  ],
  ['raw sql: a select', `sql\`select * from signatures where id = ${HOLE}\``, [use('signatures', 'sql')]],
  ['raw sql: a delete', 'sql`delete from repositories`', [use('repositories', 'sql')]],
  ['raw sql: an update', `sql\`update cla_documents set name = ${HOLE}\``, [use('cla_documents', 'sql')]],
  ['raw sql: a join', 'sql`select 1 from users join allowlist_entries on true`', [use('allowlist_entries', 'sql')]],
  [
    'raw sql: a schema and quotes',
    'sql`insert into public."pr_evaluations" (id) values (1)`',
    [use('pr_evaluations', 'sql')],
  ],
  ['raw sql: a truncate', 'sql`truncate table audit_log`', [use('audit_log', 'sql')]],
  ['raw sql: another table that starts alike', 'sql`select 1 from repositories_archive`', []],
  ['raw sql: no table', 'sql`select now()`', []],
  ['another template tag', 'html`from signatures`', []],
  ['a template that is not a tag', 'const text = `from signatures`;', []],
])('the scan finds, in %s, the uses %j', (_name, source, expected) => {
  expect(tenantTableUses('probe.ts', source)).toEqual(expected);
});

test('the scan reads a statement split over lines, with its comments, as one use', () => {
  const source = `
    const rows = await db
      // the tenant
      .selectFrom(
        'signatures',
      )
      .selectAll()
      .execute();`;
  expect(tenantTableUses('probe.ts', source)).toEqual([use('signatures', 'selectFrom')]);
});

test.each([
  ['an exported function', 'export function a() {}', ['a']],
  ['an exported async function', 'export async function a() {}', ['a']],
  ['a function that is not exported', 'function a() {}', []],
  ['an exported constant that holds an arrow function', 'export const a = () => 1;', ['a']],
  ['an exported constant that holds a function expression', 'export const a = function () {};', ['a']],
  ['an exported constant that holds a value', 'export const a = 1;', []],
  ['a constant that holds a function and is not exported', 'const a = () => 1;', []],
  ['an exported constant with no value in the declaration', 'export declare const a: number;', []],
  ['an exported destructuring', 'export const { a } = b;', []],
  ['an exported class', 'export class A {}', []],
  ['an exported type', 'export type A = string;', []],
  ['a re-export', "export { a } from './a.ts';", []],
  ['an exported default function with no name', 'export default function () {}', []],
  ['a statement that cannot carry modifiers', 'run();', []],
  [
    'two exported functions among other statements',
    'const x = 1;\nexport function a() {}\nrun();\nexport const b = () => 2;',
    ['a', 'b'],
  ],
])('the exports of %s are %j', (_name, source, expected) => {
  expect(exportedFunctions('probe.ts', source)).toEqual(expected);
});

const MODULES = ['services/listed.ts'];

test.each([
  [
    'a listed file may run any statement',
    'services/listed.ts',
    [use('repositories', 'selectFrom'), use('signatures', 'sql')],
    [],
  ],
  [
    'a file that is not listed is named',
    'services/other.ts',
    [use('repositories', 'selectFrom')],
    ['services/other.ts runs selectFrom on repositories but is not in TENANT_MODULES'],
  ],
  [
    'a file that names no table is named',
    'services/other.ts',
    [use('?', 'insertInto')],
    ['services/other.ts runs insertInto on a table it does not name but is not in TENANT_MODULES'],
  ],
  ['a file with no use is fine', 'services/other.ts', [], []],
  ['the audit writer may insert audit rows', 'services/audit.ts', [use('audit_log', 'insertInto')], []],
  [
    'no other file may insert audit rows, listed or not',
    'services/listed.ts',
    [use('audit_log', 'insertInto')],
    ['services/listed.ts inserts into audit_log; only services/audit.ts may'],
  ],
  [
    'the audit writer may not read them',
    'services/audit.ts',
    [use('audit_log', 'selectFrom')],
    ['services/audit.ts runs selectFrom on audit_log but is not in TENANT_MODULES'],
  ],
  ['a listed file may read the audit log', 'services/listed.ts', [use('audit_log', 'selectFrom')], []],
])('the scan holds the registry to it: %s', (_name, file, uses, expected) => {
  expect(scanProblems(file, uses, MODULES)).toEqual(expected);
});

test.each([
  ['services/a.ts', true],
  ['adapters/db/a.ts', true],
  ['a.test.ts', false],
  ['services/a.test.ts', false],
  ['services/x-fixture/test-support.ts', false],
  ['adapters/db/global-setup.ts', false],
  ['a.d.ts', false],
  ['services/notes.md', false],
  ['services/a.tsx', false],
])('%s is a file of the running server: %s', (file, expected) => {
  expect(isServerSource(file)).toBe(expected);
});

test('the server sources are listed in order, with forward slashes, and leave out the tests and their support files', () => {
  const sources = serverSources(new URL('../..', import.meta.url).pathname);
  expect(sources).toContain('services/tenant-queries.ts');
  expect(sources).toContain('adapters/db/tenant-scope.ts');
  expect(sources).toEqual(sources.toSorted((a, b) => a.localeCompare(b)));
  expect(sources.filter((file) => file.endsWith('.test.ts') || file.endsWith('test-support.ts'))).toEqual([]);
  expect(sources.filter((file) => file.includes('\\'))).toEqual([]);
});

test('a new file under adapters/db that reads a tenant table is named until it is listed in TENANT_MODULES', () => {
  const file = 'adapters/db/signatures-by-user.ts';
  const source = "export function list(db) { return db.selectFrom('signatures').selectAll().execute(); }";
  const uses = tenantTableUses(file, source);
  expect(scanProblems(file, uses, TENANT_MODULES)).toEqual([
    'adapters/db/signatures-by-user.ts runs selectFrom on signatures but is not in TENANT_MODULES',
  ]);
  expect(scanProblems(file, uses, [...TENANT_MODULES, file])).toEqual([]);
});

test.each([
  ['an export and an entry for it', 'export function a() {}', ['a'], []],
  [
    'an export with no entry',
    'export function a() {}\nexport const b = () => 1;',
    ['a'],
    ['services/x.ts exports b, which is not in TENANT_QUERIES'],
  ],
  [
    'an entry for nothing the module exports',
    'export function a() {}',
    ['a', 'gone'],
    ['TENANT_QUERIES has an entry gone for services/x.ts, which exports no such function'],
  ],
  [
    'both at once, the missing export first',
    'export function a() {}',
    ['gone'],
    [
      'services/x.ts exports a, which is not in TENANT_QUERIES',
      'TENANT_QUERIES has an entry gone for services/x.ts, which exports no such function',
    ],
  ],
  ['a class and a type, which are not queries', 'export class A {}\nexport type T = string;', [], []],
])('the registry holds a module to its exports: %s', (_name, source, entries, expected) => {
  expect(queryGaps('services/x.ts', source, entries)).toEqual(expected);
});
