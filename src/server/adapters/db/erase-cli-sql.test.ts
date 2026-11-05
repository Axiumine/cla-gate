// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, test } from 'vitest';

// The operator's erasure command contains no SQL that deletes or updates anything (E22-S05): the only statement that changes a
// row is the call of the audited function erase_signer_pii, which is also the only code that may remove a signer_pii row. This
// reads the source of the command with the TypeScript compiler, so a call split over lines or a word in a comment is told from a
// real statement, and holds every file of it to that: no Kysely call that writes, and no `sql` template that is not on the list.

const SERVER = path.resolve(import.meta.dirname, '../..');

/** The files of the command, relative to `src/server`: the entry, the glue, the service, its statements and the shared connection. */
const FILES = [
  'erase.ts',
  'adapters/db/erase-cli.ts',
  'adapters/db/cli-database.ts',
  'domain/erase-arguments.ts',
  'domain/operator-erasure.ts',
  'services/operator-erasure.ts',
  'services/operator-erasure-queries.ts',
] as const;

/** The Kysely calls that write a row or change a table. */
const WRITERS = new Set([
  'insertInto',
  'updateTable',
  'deleteFrom',
  'replaceInto',
  'mergeInto',
  'truncate',
  'createTable',
  'alterTable',
  'dropTable',
  'with',
]);

/** What a `sql` template says, with each placeholder shown as `$`. */
function templateText(template: ts.TemplateLiteral): string {
  return ts.isNoSubstitutionTemplateLiteral(template)
    ? template.text
    : [template.head.text, ...template.templateSpans.map((span) => `$${span.literal.text}`)].join('');
}

/** Every node of the tree below `node`, `node` included. */
function nodesOf(node: ts.Node): ts.Node[] {
  return [node, ...node.getChildren().flatMap(nodesOf)];
}

function parse(file: string): ts.SourceFile {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: the names are the constants above
  return source(file, fs.readFileSync(path.join(SERVER, file), 'utf8'));
}

const source = (name: string, text: string): ts.SourceFile =>
  ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);

/** The names of the Kysely builder calls of a source that write. */
function writingCallsIn(tree: ts.SourceFile): string[] {
  return nodesOf(tree).flatMap((node) =>
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    WRITERS.has(node.expression.name.text)
      ? [node.expression.name.text]
      : [],
  );
}

/** The text of every `sql` template of a source. */
function sqlTemplatesIn(tree: ts.SourceFile): string[] {
  return nodesOf(tree).flatMap((node) =>
    ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag) && node.tag.text === 'sql'
      ? [templateText(node.template)]
      : [],
  );
}

test.each(FILES)('%s calls no Kysely builder that writes', (file) => {
  expect(writingCallsIn(parse(file))).toEqual([]);
});

test('the only SQL of the command is three counts, the comparison of the snapshot, and the call of erase_signer_pii', () => {
  expect(FILES.flatMap((file) => sqlTemplatesIn(parse(file)))).toEqual([
    "login = 'erased-' || github_id::text",
    'count(*)',
    'count(p.signature_id)',
    'count(*)',
    'erase_signer_pii($, $, $)',
  ]);
});

test('the scan sees a write, and the SQL of a template, when there is one', () => {
  const tree = source('x.ts', "db.deleteFrom('signer_pii').execute(); sql`delete from signer_pii`;");
  expect(writingCallsIn(tree)).toEqual(['deleteFrom']);
  expect(sqlTemplatesIn(tree)).toEqual(['delete from signer_pii']);
});
