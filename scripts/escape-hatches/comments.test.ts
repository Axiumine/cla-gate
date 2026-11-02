// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import ts from 'typescript';
import { expect, test } from 'vitest';
import { commentsOf } from './comments.ts';

/** The opening of a template substitution, spelled so that no ordinary string in this file looks like a template. */
const SUBSTITUTION = ['$', '{'].join('');

/** `[line, endLine, ownLine, body]` of every comment the parser finds in `source`, as the file `name`. */
function found(source: string, name = 'm.ts'): [number, number, boolean, string][] {
  const sourceFile = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
  return commentsOf(sourceFile).map((comment) => [comment.line, comment.endLine, comment.ownLine, comment.body]);
}

test('a comment above a statement is on its own line', () => {
  expect(found('// first\nexport const a = 1;\n')).toEqual([[1, 1, true, 'first']]);
});

test('a comment behind code is not on its own line', () => {
  expect(found('export const a = 1; // trailing\n')).toEqual([[1, 1, false, 'trailing']]);
});

test('an indented comment is still on its own line', () => {
  expect(found('export function f() {\n  // inside\n  return 1;\n}\n')).toEqual([[2, 2, true, 'inside']]);
});

test('a block comment keeps the line it starts and the line it ends on', () => {
  expect(found('export const a = 1;\n/*\n * two\n * lines\n */\nexport const b = 2;\n')).toEqual([
    [2, 5, true, 'two lines'],
  ]);
});

test('a JSDoc comment is a comment, found once', () => {
  expect(found('/** Documents a. */\nexport const a = 1;\n')).toEqual([[1, 1, true, 'Documents a.']]);
});

test('comments at the start and at the end of the file are found', () => {
  expect(found('// head\nexport const a = 1;\n// tail\n')).toEqual([
    [1, 1, true, 'head'],
    [3, 3, true, 'tail'],
  ]);
});

test('a file with comments only has them', () => {
  expect(found('// one\n// two\n')).toEqual([
    [1, 1, true, 'one'],
    [2, 2, true, 'two'],
  ]);
});

test('an empty file has none', () => {
  expect(found('')).toEqual([]);
});

test('a comment between two tokens of one line is found once', () => {
  expect(found('export const a = 1 /* middle */ + 2;\n')).toEqual([[1, 1, false, 'middle']]);
});

test('a comment before a closing brace and inside a template expression are found', () => {
  const source = `export const f = () => {\n  return 1;\n  // last\n};\nexport const t = \`${SUBSTITUTION}/* in */ 1}\`;\n`;
  expect(found(source)).toEqual([
    [3, 3, true, 'last'],
    [5, 5, false, 'in'],
  ]);
});

test('comment-like text in a string, a template, a regular expression and JSX text is not a comment', () => {
  const source = [
    "export const s = '// no';",
    `export const t = \`/* no */ ${SUBSTITUTION}1}\`;`,
    'export const r = /\\/\\/ no/;',
    'export const j = <p>// no, /* not even this */</p>;',
    '',
  ].join('\n');
  expect(found(source, 'm.tsx')).toEqual([]);
});

test('a comment inside a JSX expression is a comment', () => {
  expect(found('export const j = <p>{/* real */}</p>;\n', 'm.tsx')).toEqual([[1, 1, false, 'real']]);
});

test('a comment behind a JSX element is found', () => {
  const source = 'export const j = (\n  <p>\n    text\n  </p> // after\n);\n';
  expect(found(source, 'm.tsx')).toEqual([[4, 4, false, 'after']]);
});
