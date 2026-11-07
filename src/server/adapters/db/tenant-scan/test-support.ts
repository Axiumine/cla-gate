// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { CORPORATE_TABLES, TENANT_TABLES } from '../tenant-fixture/test-support.ts';
import { AUDIT_WRITER } from '../tenant-registry/test-support.ts';

// The source scan of E11-S06: which files of the server run a statement over a tenant table, and which functions they
// export. Built on the TypeScript compiler API, so a call split over lines, a comment and a string that only looks like a
// call are told apart from a real one. The registry in tenant-registry/test-support.ts is what the findings are held to.

/** The query-builder calls that name a table: the four statements of the story, and the joins that read one more table. */
const BUILDERS = new Set([
  'selectFrom',
  'insertInto',
  'updateTable',
  'deleteFrom',
  'innerJoin',
  'leftJoin',
  'rightJoin',
  'fullJoin',
  'crossJoin',
]);

/** What the scan found: a statement over `table`, written with `via`; a table that cannot be read from the source is `?`. */
export interface TableUse {
  readonly table: string;
  readonly via: string;
}

const TENANT_NAMES: readonly string[] = [...TENANT_TABLES, ...CORPORATE_TABLES];

/** A table named after the word that starts a clause of SQL that names one. */
const RAW_TABLE = /\b(?:from|join|into|update|truncate)\s+([\w.]+)/gi;

/** The text of a `sql` template as it is read: quotes and the words `table` and `only` (as in `truncate table`, `from only`) taken out. */
const plainSql = (text: string): string => text.replaceAll('"', '').replaceAll(/\b(?:table|only)\s+/gi, '');

/** The table a builder call names: the first word of its first argument when that is a plain string (`'repositories as r'`), else `?`. */
function tableOfArgument(argument: ts.Expression | undefined): string {
  if (argument !== undefined && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
    return argument.text.trim().split(/\s+/, 1).join('');
  }
  return '?';
}

/** The text of a template literal with its substitutions left out. */
function templateText(template: ts.TemplateLiteral): string {
  return ts.isNoSubstitutionTemplateLiteral(template)
    ? template.text
    : [template.head.text, ...template.templateSpans.map((span) => span.literal.text)].join(' ');
}

/** The uses a single node is: a builder call, or a `sql` template with a tenant table in it. */
function usesOf(node: ts.Node): TableUse[] {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const via = node.expression.name.text;
    return BUILDERS.has(via) ? [{ table: tableOfArgument(node.arguments[0]), via }] : [];
  }
  if (ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag) && node.tag.text === 'sql') {
    return [...plainSql(templateText(node.template)).matchAll(RAW_TABLE)]
      .flatMap((match) => match.slice(1))
      .map((table) => ({ table: table.toLowerCase().replace(/^public\./, ''), via: 'sql' }));
  }
  return [];
}

/** What `pick` finds in `node` and in everything below it. */
function collect<T>(node: ts.Node, pick: (node: ts.Node) => T[]): T[] {
  const found = pick(node);
  ts.forEachChild(node, (child) => {
    found.push(...collect(child, pick));
  });
  return found;
}

function parse(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/**
 * Every statement of `source` over a tenant table (`TENANT_TABLES` and `CORPORATE_TABLES`), and every builder call whose table is not a string
 * literal: `selectFrom(name)` cannot be checked, so it counts as a use of the table `?`. Other tables are not reported.
 */
export function tenantTableUses(fileName: string, source: string): TableUse[] {
  return collect(parse(fileName, source), usesOf).filter(
    (use) => use.table === '?' || TENANT_NAMES.includes(use.table),
  );
}

const exported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

/** The exported names of one top-level statement that are functions: a function declaration, or a constant holding a function. */
function exportedFunctionsOf(statement: ts.Statement): string[] {
  if (!exported(statement)) {
    return [];
  }
  if (ts.isFunctionDeclaration(statement)) {
    return statement.name === undefined ? [] : [statement.name.text];
  }
  if (!ts.isVariableStatement(statement)) {
    return [];
  }
  return statement.declarationList.declarations.flatMap((declaration) =>
    ts.isIdentifier(declaration.name) &&
    declaration.initializer !== undefined &&
    (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
      ? [declaration.name.text]
      : [],
  );
}

/**
 * The functions `source` exports: declarations and constants that hold a function. A function re-exported from another
 * file belongs to that file, which is scanned on its own; a class is not a function and is not listed.
 */
export function exportedFunctions(fileName: string, source: string): string[] {
  return parse(fileName, source).statements.flatMap(exportedFunctionsOf);
}

/**
 * What is wrong with the registry entries `entries` of one listed module: a function the module exports that has no entry,
 * and an entry that names no function the module exports.
 */
export function queryGaps(file: string, source: string, entries: readonly string[]): string[] {
  const exports = exportedFunctions(file, source);
  return [
    ...exports
      .filter((name) => !entries.includes(name))
      .map((name) => `${file} exports ${name}, which is not in TENANT_QUERIES`),
    ...entries
      .filter((name) => !exports.includes(name))
      .map((name) => `TENANT_QUERIES has an entry ${name} for ${file}, which exports no such function`),
  ];
}

/**
 * What is wrong with the way `file` (relative to `src/server`) uses tenant tables, given the files `modules` the registry
 * lists. A file that runs any statement over a tenant table must be listed, except that `audit_log` is inserted only by
 * {@link AUDIT_WRITER}; a builder call with a table that is not a literal cannot be checked and is refused too.
 */
export function scanProblems(file: string, uses: readonly TableUse[], modules: readonly string[]): string[] {
  const listed = modules.includes(file);
  return uses.flatMap((use) => {
    if (use.table === 'audit_log' && use.via === 'insertInto') {
      return file === AUDIT_WRITER ? [] : [`${file} inserts into audit_log; only ${AUDIT_WRITER} may`];
    }
    return listed ? [] : [`${file} runs ${use.via} on ${tableName(use)} but is not in TENANT_MODULES`];
  });
}

/** The table of a use as a sentence has it. */
const tableName = (use: TableUse): string => (use.table === '?' ? 'a table it does not name' : use.table);

/** True for a file of the running server: not a test, not a test-support file, not a type declaration, not the Vitest setup. */
export function isServerSource(relativePath: string): boolean {
  const name = path.basename(relativePath);
  return (
    name.endsWith('.ts') &&
    !name.endsWith('.test.ts') &&
    !name.endsWith('.d.ts') &&
    name !== 'test-support.ts' &&
    name !== 'global-setup.ts'
  );
}

/** The server's source files under `root`, as paths relative to it with forward slashes, in order. */
export function serverSources(root: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: `root` is the server's own source directory, given by the test
  return fs
    .readdirSync(root, { recursive: true, encoding: 'utf8' })
    .map((entry) => entry.split(path.sep).join('/'))
    .filter(isServerSource)
    .toSorted((a, b) => a.localeCompare(b));
}
