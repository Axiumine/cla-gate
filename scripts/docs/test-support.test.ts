// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from 'vitest';
import { exists, findOnPath, readText } from '../ci/lib/test-support.ts';
import { tempDir } from '../code-caps/test-support.ts';
import { modeOf } from '../compose/test-support.ts';
import {
  codeBlocks,
  GUIDES,
  guidePath,
  headingsOf,
  inOrder,
  linksOf,
  placeholder,
  proseOf,
  ROOT,
  readHeldAcross,
  sectionsOf,
  serverSource,
  slugOf,
  sourceFilesMentioning,
  tablesOf,
  writeScratch,
} from './test-support.ts';

// The helpers that read the operator guides as data (E19-S09). Every guide test depends on them, so a helper that quietly
// finds nothing would make a guide test pass for the wrong reason; each one is pinned here on a small document.

const DOCUMENT = [
  '# Title',
  '',
  'Intro with [a link](other.md#part) and [another](https://example.test/page).',
  '',
  '```sh',
  '# not a heading',
  'echo one',
  '```',
  '',
  '## First `part`',
  '',
  'Body of the first part.',
  '',
  '1. A step:',
  '',
  '   ```sh',
  '   echo indented',
  '   ```',
  '',
  '### Deeper',
  '',
  'Inside the first part.',
  '',
  '## Second part',
  '',
  '| A | B |',
  '|---|---|',
  '| 1 | 2 |',
  '| 3 | 4 |',
  '',
  '````text',
  '```',
  'still inside',
  '````',
  '',
  '#nospace is not a heading, and neither is #',
].join('\n');

test('fenced blocks are found with their language, an indented fence loses its indent, and a longer fence holds a shorter one', () => {
  expect(codeBlocks(DOCUMENT)).toEqual([
    { language: 'sh', text: '# not a heading\necho one' },
    { language: 'sh', text: 'echo indented' },
    { language: 'text', text: '```\nstill inside' },
  ]);
  expect(codeBlocks(DOCUMENT, 'text')).toHaveLength(1);
  expect(codeBlocks(DOCUMENT, 'yaml')).toEqual([]);
});

test('the prose of a document has no fenced line, and so no heading hides in a shell comment', () => {
  const prose = proseOf(DOCUMENT);
  expect(prose).not.toContain('echo one');
  expect(prose).not.toContain('still inside');
  expect(prose).toContain('Body of the first part.');
  expect(headingsOf(DOCUMENT)).toEqual(['Title', 'First `part`', 'Deeper', 'Second part']);
});

test('sections run to the next heading of the same or a higher level and keep the deeper ones', () => {
  const second = sectionsOf(DOCUMENT, 2);
  expect(second.map((section) => section.heading)).toEqual(['First `part`', 'Second part']);
  expect(second[0]?.body).toContain('### Deeper');
  expect(second[0]?.body).toContain('Inside the first part.');
  expect(second[0]?.body).not.toContain('| A | B |');
  expect(sectionsOf(DOCUMENT, 3).map((section) => section.heading)).toEqual(['Deeper']);
  expect(sectionsOf(DOCUMENT, 3)[0]?.body).not.toContain('Second part');
  expect(sectionsOf(DOCUMENT, 1).map((section) => section.heading)).toEqual(['Title']);
});

test('slugs follow GitHub: lower case, backticks and punctuation dropped, spaces to hyphens', () => {
  expect(slugOf('First `part`')).toBe('first-part');
  expect(slugOf('When `migrate` refuses')).toBe('when-migrate-refuses');
  expect(slugOf('Stop, keep everything')).toBe('stop-keep-everything');
  expect(slugOf('Database role passwords (`DATABASE_URL`, `MIGRATION_DATABASE_URL`)')).toBe(
    'database-role-passwords-database_url-migration_database_url',
  );
});

test('links are the targets of inline links in the prose, and a bracket without a link is not one', () => {
  expect(linksOf(DOCUMENT)).toEqual(['other.md#part', 'https://example.test/page']);
  expect(linksOf('Nothing here, only [brackets] and (parentheses).')).toEqual([]);
  expect(linksOf('A broken [link](never closed')).toEqual([]);
});

test('a table has its separator as written and its rows as trimmed cells, and a document can hold several', () => {
  expect(tablesOf(DOCUMENT)).toEqual([
    {
      separator: '|---|---|',
      rows: [
        ['1', '2'],
        ['3', '4'],
      ],
    },
  ]);
  expect(tablesOf('| A |\n|:--|\n| x |\n\ntext\n\n| B |\n|---|\n| y |').map((table) => table.separator)).toEqual([
    '|:--|',
    '|---|',
  ]);
  expect(tablesOf('no table')).toEqual([]);
});

test('inOrder wants every needle, each after the one before', () => {
  expect(inOrder('one two three', ['one', 'two', 'three'])).toBe(true);
  expect(inOrder('one two three', ['three', 'one'])).toBe(false);
  expect(inOrder('one two three', ['one', 'four'])).toBe(false);
  expect(inOrder('aa', ['a', 'a'])).toBe(true);
  expect(inOrder('a', ['a', 'a'])).toBe(false);
});

test('a placeholder is spelled as source text, and the guides are the eight files of docs/operations', () => {
  expect(placeholder('name')).toBe(['$', '{name}'].join(''));
  expect(GUIDES).toHaveLength(8);
  expect(guidePath('install')).toBe(path.join(ROOT, 'docs', 'operations', 'install.md'));
  expect(GUIDES.filter((name) => !exists(guidePath(name)))).toEqual([]);
});

test('the source of the server holds its code and not its tests, and names the files that mention a thing', () => {
  expect(serverSource()).toContain('export class ConfigError');
  expect(serverSource()).not.toContain('operator-reverse-proxy');
  expect(sourceFilesMentioning('export class ConfigError')).toEqual(['src/server/config/config-error.ts']);
  expect(sourceFilesMentioning('a sentence that no file of the server contains 7f3a9c')).toEqual([]);
});

test('a held file keeps its old content when the path is replaced, and a scratch file has the mode it was given', () => {
  const directory = tempDir();
  const target = writeScratch(directory, 'secret', 'old\n', 0o444);
  const staged = writeScratch(directory, 'staged', 'new\n');
  expect(modeOf(target)).toBe('444');
  const seen = readHeldAcross(target, () => {
    expect(spawnSync(findOnPath('mv'), [staged, target]).status).toBe(0);
  });
  expect(seen).toBe('old\n');
  expect(readText(target)).toBe('new\n');
});

test('a held file is closed again when the change throws', () => {
  const directory = tempDir();
  const target = writeScratch(directory, 'secret', 'old\n');
  expect(() =>
    readHeldAcross(target, () => {
      throw new Error('the change failed');
    }),
  ).toThrow('the change failed');
});
