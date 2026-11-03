// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import ts from 'typescript';
import { expect, test } from 'vitest';
import { readText } from '../ci/lib/test-support.ts';
import { listFiles, ROOT } from './test-support.ts';

// E19-S01: the container runs with a read-only root filesystem, so the server and the migration command write nothing
// to disk (their logs go to stdout). This is the static half of that promise, a guard over the production sources: every
// use of the file system modules is a read. E19-S08 asserts the dynamic half, a run with `read_only: true`.

const READS = new Set([
  'readFile',
  'readFileSync',
  'readdir',
  'readdirSync',
  'stat',
  'statSync',
  'lstat',
  'lstatSync',
  'access',
  'accessSync',
  'existsSync',
]);
const FS_MODULES = new Set(['node:fs', 'node:fs/promises', 'fs', 'fs/promises']);

function fileSystemImports(file: ts.SourceFile): ts.ImportClause[] {
  return file.statements
    .filter(ts.isImportDeclaration)
    .filter(
      (declaration) =>
        ts.isStringLiteral(declaration.moduleSpecifier) && FS_MODULES.has(declaration.moduleSpecifier.text),
    )
    .flatMap((declaration) => (declaration.importClause === undefined ? [] : [declaration.importClause]));
}

/** The local names under which a clause binds the whole module: a default import and a namespace import. */
function wholeModuleNames(clause: ts.ImportClause): string[] {
  const { name, namedBindings } = clause;
  return [
    ...(name === undefined ? [] : [name.text]),
    ...(namedBindings && ts.isNamespaceImport(namedBindings) ? [namedBindings.name.text] : []),
  ];
}

/** The members imported by name: `import { readFile as read }` is `readFile`. */
function namedMembers(clause: ts.ImportClause): string[] {
  const { namedBindings } = clause;
  return namedBindings && ts.isNamedImports(namedBindings)
    ? namedBindings.elements.map((element) => (element.propertyName ?? element.name).text)
    : [];
}

/** The members of the file system modules that `source` uses: the named imports, and `name.member` for a default or namespace import. */
function fileSystemMembers(source: string): string[] {
  const file = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  const clauses = fileSystemImports(file);
  const locals = new Set(clauses.flatMap(wholeModuleNames));
  const members = clauses.flatMap(namedMembers);
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && locals.has(node.expression.text)) {
      members.push(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return members;
}

const production = [...listFiles('src/server'), ...listFiles('src/shared')].filter(
  (file) =>
    file.endsWith('.ts') && !/\.test\.ts$|\/test-support\.ts$|\/global-setup\.ts$|\/pglite(?:\/|\.ts$)/.test(file),
);
const usedMembers = new Map(production.map((file) => [file, fileSystemMembers(readText(path.join(ROOT, file)))]));

test('the guard reads the production sources and finds the three that read files', () => {
  expect(production.length).toBeGreaterThan(200);
  expect(production.filter((file) => (usedMembers.get(file) ?? []).length > 0)).toEqual([
    'src/server/adapters/db/migration-files.ts',
    'src/server/adapters/github/package-version.ts',
    'src/server/adapters/http/spa.ts',
  ]);
});

test('no production source writes to the file system: every member of fs it uses is a read', () => {
  const writes = [...usedMembers].flatMap(([file, members]) =>
    members.filter((member) => !READS.has(member)).map((member) => `${file}: ${member}`),
  );
  expect(writes).toEqual([]);
});

test.each([
  ["import { writeFile } from 'node:fs/promises';", ['writeFile']],
  ["import { readFile, mkdir as make } from 'node:fs/promises';", ['readFile', 'mkdir']],
  ["import fs from 'node:fs';\nfs.writeFileSync(a, b); fs.statSync(a);", ['writeFileSync', 'statSync']],
  ["import * as files from 'fs';\nfiles.rmSync(a);", ['rmSync']],
  ["import 'node:fs';", []],
  ["import path from 'node:path';\npath.join(a);", []],
])('the guard understands %j', (source, members) => {
  expect(fileSystemMembers(source)).toEqual(members);
});
