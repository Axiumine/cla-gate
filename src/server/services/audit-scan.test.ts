// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { AUDIT_ACTIONS, AUDIT_METADATA_KEYS } from '../../shared/audit.ts';
import { sourceTree } from '../source-tree/test-support.ts';
import { type AuditFixture, entryOf, fixtureProblems, siteId } from './audit-conformance/test-support.ts';
import type { AuditEntry } from './audit-entry.ts';
import { auditCallSites, auditInsertions, catalogueProblems, usageProblems } from './audit-scan/test-support.ts';
import { ACTOR } from './test-support.ts';

// The source scan itself (E16-S01): what it finds in a piece of source, shown on made-up sources. What it finds in the
// server is audit-catalogue.test.ts, audit-conformance.test.ts and audit-single-writer.test.ts.

const SERVER = sourceTree(path.resolve(import.meta.dirname, '..'));

const HEADER = [
  "import type { Transaction } from 'kysely';",
  "import type { Database } from '../adapters/db/schema.ts';",
  "import { appendAudit, type AuditEntry } from './audit.ts';",
].join('\n');

/** Made-up files, scanned in one program next to the real ones: a call and what the scan has to say about it. */
const SOURCES: Readonly<Record<string, string>> = {
  'services/scan-literal.ts': `${HEADER}
export function write(trx: Transaction<Database>) {
  return appendAudit(trx, {
    action: 'repository.added',
    installationId: 1,
    actorGithubId: null,
    metadata: { reason_code: 'not_listed', count: 1 },
  });
}`,
  'services/scan-conditional.ts': `${HEADER}
export function write(trx: Transaction<Database>, on: boolean) {
  return appendAudit(trx, {
    action: on ? 'repository.enabled' : 'repository.disabled',
    installationId: 1,
    actorGithubId: null,
    metadata: on ? { repository_id: 1, document_id: 2 } : { repository_id: 1 },
  });
}`,
  'services/scan-parameter.ts': `${HEADER}
export function write(trx: Transaction<Database>, entry: { readonly action: 'installation.updated' | 'installation.deleted' }) {
  return appendAudit(trx, { action: entry.action, installationId: 1, actorGithubId: null });
}`,
  'services/scan-renamed.ts': `import type { Transaction } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import { appendAudit as record } from './audit.ts';
export function write(trx: Transaction<Database>) {
  return record(trx, { action: 'installation.suspended', installationId: 1, actorGithubId: null });
}`,
  'services/scan-other.ts': `${HEADER}
export function write(trx: Transaction<Database>) {
  const insert = (table: string) => trx.insertInto('audit_log').values({ table }).execute();
  return insert('x');
}
export type Unused = AuditEntry;`,
  'services/scan-wide.ts': `${HEADER}
export function write(trx: Transaction<Database>, entry: AuditEntry) {
  return appendAudit(trx, entry);
}`,
  'services/scan-string.ts': `${HEADER}
export function write(trx: Transaction<Database>, name: string) {
  return appendAudit(trx, { action: name, installationId: 1, actorGithubId: null });
}`,
  'services/scan-any.ts': `${HEADER}
export function write(trx: Transaction<Database>) {
  return appendAudit(trx, JSON.parse('{}'));
}`,
  'services/scan-empty.ts': `${HEADER}
export function write(trx: Transaction<Database>) {
  return appendAudit(trx);
}`,
};

const found = auditCallSites(SERVER, Object.keys(SOURCES), new Map(Object.entries(SOURCES)));

const sitesOf = (file: string) => found.filter((site) => site.file === file);

test.each([
  [
    'a literal action and the keys of a literal metadata object',
    'services/scan-literal.ts',
    { actions: ['repository.added'], metadataKeys: ['count', 'reason_code'], problems: [] },
  ],
  [
    'a conditional action and conditional metadata give every name either branch writes',
    'services/scan-conditional.ts',
    {
      actions: ['repository.disabled', 'repository.enabled'],
      metadataKeys: ['document_id', 'repository_id'],
      problems: [],
    },
  ],
  [
    'an action read from a narrowed field, and no metadata',
    'services/scan-parameter.ts',
    { actions: ['installation.deleted', 'installation.updated'], metadataKeys: [], problems: [] },
  ],
  [
    'a call through an import under another name',
    'services/scan-renamed.ts',
    { actions: ['installation.suspended'], metadataKeys: [], problems: [] },
  ],
  [
    'an action that is only a string is not a literal',
    'services/scan-string.ts',
    { actions: [], metadataKeys: [], problems: ['the action is not a string literal'] },
  ],
  [
    'an entry the checker reads as any has no readable action',
    'services/scan-any.ts',
    { actions: [], metadataKeys: [], problems: ['the action of the entry cannot be read'] },
  ],
  [
    'a call with no entry argument',
    'services/scan-empty.ts',
    { actions: [], metadataKeys: [], problems: ['the call has no entry'] },
  ],
])('the call scan: %s', (_name, file, expected) => {
  expect(sitesOf(file).map(({ actions, metadataKeys, problems }) => ({ actions, metadataKeys, problems }))).toEqual([
    expected,
  ]);
});

test('an entry typed as the whole AuditEntry hides every name, so the call is a problem', () => {
  const [site] = sitesOf('services/scan-wide.ts');
  expect(site?.problems).toEqual([
    'the action is the whole AuditAction type: narrow it to the names the call writes',
    'the metadata is the whole AuditMetadata type: write an object literal',
  ]);
  expect(site?.actions).toEqual([...AUDIT_ACTIONS].toSorted((a, b) => a.localeCompare(b)));
  expect(site?.metadataKeys).toEqual([...AUDIT_METADATA_KEYS].toSorted((a, b) => a.localeCompare(b)));
});

test('a file that inserts into the audit table by itself is not a call of appendAudit', () => {
  expect(sitesOf('services/scan-other.ts')).toEqual([]);
});

test('the scan reports the line of the call and lists the real call sites of the server', () => {
  expect(sitesOf('services/scan-literal.ts').map((site) => site.line)).toEqual([5]);
  const real = auditCallSites(SERVER, ['services/installation-sync-deleted.ts', 'services/audit.ts']);
  expect(real.map((site) => ({ file: site.file, actions: site.actions }))).toEqual([
    { file: 'services/installation-sync-deleted.ts', actions: ['installation.deleted'] },
  ]);
});

/** A `sql` template with a part to fill in, built from pieces so that no string of this file holds the characters that start one. */
const HOLE = ['$', '{id}'].join('');

test.each([
  ['a Kysely insert', "trx.insertInto('audit_log').values(row)", ["insertInto('audit_log')"]],
  ['a Kysely insert with a template literal', 'trx.insertInto(`audit_log`)', ["insertInto('audit_log')"]],
  ['a Kysely insert naming the public schema', "trx.insertInto('public.audit_log')", ["insertInto('audit_log')"]],
  ['a plain statement', "const s = 'insert into audit_log (action) values (1)';", ['insert into audit_log']],
  ['a statement in capitals with extra blanks', "const s = 'INSERT   INTO audit_log';", ['insert into audit_log']],
  [
    'a statement with a quoted schema and table',
    'const s = \'insert into "public"."audit_log" (a)\';',
    ['insert into audit_log'],
  ],
  [
    'a template with a part to fill in',
    `sql\`insert into audit_log (actor) values (${HOLE})\``,
    ['insert into audit_log'],
  ],
  ['a statement on several lines', 'const s = `insert\n  into\n  audit_log`;', ['insert into audit_log']],
  ['an insert into another table', "trx.insertInto('signatures').values(row)", []],
  ['an insert into a table that only starts with the name', "trx.insertInto('audit_log_archive')", []],
  ['a statement into a table that only starts with the name', "const s = 'insert into audit_log_archive';", []],
  ['a select from the table', "db.selectFrom('audit_log').selectAll()", []],
  ['a read in SQL', "const s = 'select * from audit_log';", []],
  ['an insert named by a variable', 'trx.insertInto(table)', []],
  ['an insert with no table', 'trx.insertInto()', []],
  ['a function of that name that is not a method', "insertInto('audit_log')", []],
  ['a comment that looks like the statement', '// insert into audit_log (action)\nconst a = 1;', []],
])('the second-writer scan: %s', (_name, source, expected) => {
  expect(auditInsertions('services/x.ts', source)).toEqual(expected);
});

const ACTIONS = ['a.one', 'a.two', 'a.three'];

test.each([
  ['a name that is present', ACTIONS, ['a.two'], []],
  [
    'a name that is missing is named in the message',
    ACTIONS,
    ['a.two', 'b.four'],
    ['AUDIT_ACTIONS lacks b.four: add it in the change that writes it'],
  ],
  [
    'a name that is listed twice is named once',
    ['a.one', 'a.two', 'a.one', 'a.one'],
    ['a.two'],
    ['AUDIT_ACTIONS lists a.one more than once'],
  ],
])('the catalogue check: %s', (_name, actions, required, expected) => {
  expect(catalogueProblems(actions, required)).toEqual(expected);
});

test.each([
  [
    'every name is written or reserved',
    ['a.one'],
    { 'a.two': 'built later', 'a.three': 'a SQL function writes it' },
    [],
  ],
  [
    'a written name that is not in the catalogue',
    ['a.one', 'a.four'],
    { 'a.two': 'x', 'a.three': 'x' },
    ['a.four is written by a call site but is not in AUDIT_ACTIONS'],
  ],
  [
    'a name that nobody writes and nobody reserves',
    ['a.one'],
    { 'a.two': 'x' },
    ['a.three is written by no call site and is not in RESERVED_ACTIONS'],
  ],
  [
    'a reserved name that a call site writes',
    ['a.one', 'a.two'],
    { 'a.two': 'x', 'a.three': 'x' },
    ['a.two is in RESERVED_ACTIONS but a call site writes it: remove the entry'],
  ],
  [
    'a reserved name that the catalogue does not have',
    ['a.one'],
    { 'a.two': 'x', 'a.three': 'x', 'a.five': 'x' },
    ['a.five is in RESERVED_ACTIONS but not in AUDIT_ACTIONS'],
  ],
  [
    'a reason that is empty or runs over several lines',
    ['a.one'],
    { 'a.two': '', 'a.three': 'first\nsecond' },
    [
      'a.two is in RESERVED_ACTIONS without a one-line reason',
      'a.three is in RESERVED_ACTIONS without a one-line reason',
    ],
  ],
])('the usage check: %s', (_name, written, reserved, expected) => {
  expect(usageProblems(ACTIONS, new Set(written), reserved)).toEqual(expected);
});

const SITE = {
  file: 'services/x.ts',
  actions: ['repository.disabled', 'repository.enabled'],
  metadataKeys: ['count', 'rows'],
};
const SITE_ID = 'services/x.ts#repository.disabled|repository.enabled';
const ENABLED: AuditFixture = { action: 'repository.enabled', metadata: { count: 1, rows: [1] } };
const DISABLED: AuditFixture = { action: 'repository.disabled' };

test('a call site is named by its file and the actions it can write', () => {
  expect(siteId(SITE)).toBe(SITE_ID);
});

test.each<[string, Parameters<typeof fixtureProblems>[0], Parameters<typeof fixtureProblems>[1], string[]]>([
  ['fixtures that write the same actions and keys as the call', [SITE], { [SITE_ID]: [ENABLED, DISABLED] }, []],
  ['a call site with no fixtures', [SITE], {}, [`${SITE_ID} has no fixture`]],
  [
    'fixtures for a call site that is not in the code',
    [SITE],
    { [SITE_ID]: [ENABLED, DISABLED], 'services/gone.ts#installation.deleted': [{ action: 'installation.deleted' }] },
    ['services/gone.ts#installation.deleted has fixtures but no call site writes it'],
  ],
  [
    'fixtures that leave one of the actions out',
    [SITE],
    { [SITE_ID]: [ENABLED] },
    [`${SITE_ID}: the fixtures write other actions than the call`],
  ],
  [
    'fixtures that leave a metadata key out',
    [SITE],
    { [SITE_ID]: [{ action: 'repository.enabled', metadata: { count: 1 } }, DISABLED] },
    [`${SITE_ID}: the fixtures write other metadata keys than the call`],
  ],
  [
    'two calls in one file with the same actions are held to their keys together',
    [
      { ...SITE, metadataKeys: ['count'] },
      { ...SITE, metadataKeys: ['rows'] },
    ],
    { [SITE_ID]: [ENABLED, DISABLED] },
    [],
  ],
])('the fixture check: %s', (_name, sites, fixtures, expected) => {
  expect(fixtureProblems(sites, fixtures)).toEqual(expected);
});

test.each<[string, AuditFixture, AuditEntry]>([
  [
    'a tenant action by a person carries its installation, subject and metadata',
    { action: 'repository.enabled', subject: { type: 'repository', id: 9 }, metadata: { count: 1 } },
    {
      action: 'repository.enabled',
      installationId: 7,
      actorGithubId: ACTOR,
      subject: { type: 'repository', id: 9 },
      metadata: { count: 1 },
    },
  ],
  [
    'a system action has no person and no subject or metadata unless the fixture has them',
    { action: 'installation.deleted' },
    { action: 'installation.deleted', installationId: 7, actorGithubId: null },
  ],
  [
    'an instance action has no installation',
    { action: 'data_export.created' },
    { action: 'data_export.created', installationId: null, actorGithubId: ACTOR },
  ],
])('the entry of a fixture: %s', (_name, fixture, expected) => {
  expect(entryOf(fixture, 7)).toStrictEqual(expected);
});
