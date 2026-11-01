// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { expect, test } from 'vitest';
import { measureRepo, sourceFiles } from './files.ts';
import { func, git, makeRepo, tempDir } from './test-support.ts';
import { CapsError, compareNames } from './types.ts';

const SMALL = 'export const a = 1;\n';

/** Tool state that is never source, spelled out so the contract is pinned and not echoed. */
const TOOL_DIRS = ['.git', '.gitnexus', '.claude', '.idea', '.yarn', 'node_modules'];

/** Build and report output, skipped only when walking a plain directory. */
const OUTPUT_DIRS = [
  '.stryker-tmp',
  '.vitest',
  'build',
  'dist',
  'coverage',
  'reports',
  'playwright-report',
  'test-results',
];

/** A `{path: SMALL}` file map. */
function smallFiles(names: readonly string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, SMALL]));
}

test('keeps only source extensions, sorted', () => {
  const root = tempDir();
  const names = ['z.ts', 'a.tsx', 'b.mts', 'c.cts', 'd.js', 'e.jsx', 'f.mjs', 'g.cjs', 'h.json', 'i.md', 'j.py'];
  makeRepo(root, smallFiles([...names, 'dir/k.ts']));
  expect(sourceFiles(root)).toEqual(['a.tsx', 'b.mts', 'c.cts', 'd.js', 'dir/k.ts', 'e.jsx', 'f.mjs', 'g.cjs', 'z.ts']);
});

test('walking a plain directory prunes every tool and output directory, at the top and deeper', () => {
  const root = tempDir();
  const inside = [...TOOL_DIRS, ...OUTPUT_DIRS].flatMap((dir) => [`${dir}/top.ts`, `src/${dir}/deep.ts`]);
  makeRepo(root, smallFiles([...inside, 'src/ok.ts']));
  expect(sourceFiles(root)).toEqual(['src/ok.ts']);
});

test('a directory whose name looks like a source file is not a file', () => {
  const root = tempDir();
  makeRepo(root, smallFiles(['odd.ts/inner.ts']));
  expect(sourceFiles(root)).toEqual(['odd.ts/inner.ts']);
});

test('names are sorted by code point, uppercase first', () => {
  const root = tempDir();
  makeRepo(root, smallFiles(['b.ts', 'A.ts', 'a.ts', 'B.ts']));
  expect(sourceFiles(root)).toEqual(['A.ts', 'B.ts', 'a.ts', 'b.ts']);
  git(root, 'init', '-q');
  expect(sourceFiles(root)).toEqual(['A.ts', 'B.ts', 'a.ts', 'b.ts']);
});

// --------------------------------------------------------------------------- git

test('uses git: honours .gitignore and lists untracked files', () => {
  const root = tempDir();
  git(root, 'init', '-q');
  makeRepo(root, { '.gitignore': 'ignored.ts\n', 'ignored.ts': SMALL, 'untracked.ts': SMALL });
  expect(sourceFiles(root)).toEqual(['untracked.ts']);
});

test('uses git: a tracked path below a tool directory is skipped at any depth', () => {
  const root = tempDir();
  git(root, 'init', '-q');
  const inside = TOOL_DIRS.filter((dir) => dir !== '.git').map((dir) => `a/b/${dir}/c.ts`);
  makeRepo(root, smallFiles([...inside, 'a/b/ok.ts']));
  expect(sourceFiles(root)).toEqual(['a/b/ok.ts']);
});

test('uses git: source in a directory named like build output is still measured', () => {
  const root = tempDir();
  git(root, 'init', '-q');
  makeRepo(root, smallFiles(OUTPUT_DIRS.map((dir) => `src/${dir}/x.ts`)));
  expect(sourceFiles(root)).toEqual(OUTPUT_DIRS.map((dir) => `src/${dir}/x.ts`).sort(compareNames));
});

test('uses git: a tracked file deleted from the work tree is skipped', () => {
  const root = tempDir();
  git(root, 'init', '-q');
  makeRepo(root, smallFiles(['gone.ts', 'kept.ts']));
  git(root, 'add', '.');
  fs.rmSync(path.join(root, 'gone.ts'));
  expect(sourceFiles(root)).toEqual(['kept.ts']);
});

test('uses git: a listing above 1 MiB is read in full, so .gitignore still applies', () => {
  const root = tempDir();
  git(root, 'init', '-q');
  const names = Array.from({ length: 5300 }, (_, index) => `${'x'.repeat(200)}${index}.ts`);
  makeRepo(root, { ...smallFiles(names), '.gitignore': 'ignored.ts\n', 'ignored.ts': SMALL });
  expect(sourceFiles(root)).toHaveLength(5300);
});

// --------------------------------------------------------------------------- file names

test.skipIf(process.platform !== 'linux')(
  'a source file whose name is not valid UTF-8 is an error, not skipped',
  () => {
    const root = tempDir();
    fs.writeFileSync(Buffer.concat([Buffer.from(`${root}/caf`), Buffer.from([0xe9]), Buffer.from('.ts')]), SMALL);
    expect(() => sourceFiles(root)).toThrow(CapsError);
    expect(() => sourceFiles(root)).toThrow(/^file name is not valid UTF-8: caf\ufffd\.ts$/u);
  },
);

test.skipIf(process.platform !== 'linux')('a non-source file with a bad name is ignored', () => {
  const root = tempDir();
  fs.writeFileSync(Buffer.concat([Buffer.from(`${root}/caf`), Buffer.from([0xe9]), Buffer.from('.png')]), SMALL);
  expect(sourceFiles(root)).toEqual([]);
});

// --------------------------------------------------------------------------- measuring

test('measures every source file of the repository', () => {
  const root = tempDir();
  makeRepo(root, { 'src/big.ts': func('huge', 60), 'src/small.ts': SMALL, 'top.js': func('top', 55) });
  const found = measureRepo(root).map((item) => [item.path, item.name, item.value]);
  expect(found).toEqual([
    ['src/big.ts', 'huge', 60],
    ['top.js', 'top', 55],
  ]);
});

test('a syntax error names the file', () => {
  const root = tempDir();
  makeRepo(root, { 'ok.ts': SMALL, 'bad.ts': 'function (:\n' });
  expect(() => measureRepo(root)).toThrow(CapsError);
  expect(() => measureRepo(root)).toThrow(/^bad\.ts:1: /);
});
