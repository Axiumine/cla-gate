// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { afterEach, expect, test, vi } from 'vitest';
import { gitFiles, measureRepo, sourceFiles, walkFiles } from './files.ts';
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

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A directory name, and whether it belongs to the tool-directory set or the output-directory set. */
const DIRECTORIES: (readonly [string, 'tool' | 'output'])[] = [
  ...TOOL_DIRS.map((name) => [name, 'tool'] as const),
  ...OUTPUT_DIRS.map((name) => [name, 'output'] as const),
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

test.each(DIRECTORIES)('walking a plain directory prunes %s (%s directory) at the top and nested', (name) => {
  const root = tempDir();
  makeRepo(root, smallFiles([`${name}/top.ts`, `src/${name}/deep.ts`, `src/a/${name}/deeper.ts`, 'src/ok.ts']));
  expect(sourceFiles(root)).toEqual(['src/ok.ts']);
});

test('the plain walk lists files of every extension and leaves out the files of pruned directories only', () => {
  const root = tempDir();
  makeRepo(root, smallFiles(['a.ts', 'notes.md', 'sub/b.png', 'node_modules/x.ts', 'sub/dist/y.ts']));
  expect(walkFiles(root).sort(compareNames)).toEqual(['a.ts', 'notes.md', 'sub/b.png']);
});

test('a directory whose name looks like a source file is not a file', () => {
  const root = tempDir();
  makeRepo(root, smallFiles(['odd.ts/inner.ts']));
  expect(sourceFiles(root)).toEqual(['odd.ts/inner.ts']);
});

test('names are sorted by code point in a plain directory: uppercase first, a file before the directory of the same stem', () => {
  const root = tempDir();
  makeRepo(root, smallFiles(['C.ts', 'a/b.ts', 'a.ts', 'B.ts']));
  expect(sourceFiles(root)).toEqual(['B.ts', 'C.ts', 'a.ts', 'a/b.ts']);
});

// --------------------------------------------------------------------------- git

test('uses git: honours .gitignore and lists untracked files', () => {
  const root = tempDir();
  git(root, 'init', '-q');
  makeRepo(root, { '.gitignore': 'ignored.ts\n', 'ignored.ts': SMALL, 'untracked.ts': SMALL });
  expect(sourceFiles(root)).toEqual(['untracked.ts']);
});

test('names are sorted by code point in a repository: uppercase first, tracked and untracked files together', () => {
  const root = tempDir();
  git(root, 'init', '-q');
  makeRepo(root, smallFiles(['C.ts', 'a.ts', 'B.ts']));
  git(root, 'add', 'C.ts', 'a.ts');
  expect(sourceFiles(root)).toEqual(['B.ts', 'C.ts', 'a.ts']);
});

test.each(TOOL_DIRS.filter((name) => name !== '.git'))(
  'uses git: a path below the tool directory %s is skipped at the top and at any depth',
  (name) => {
    const root = tempDir();
    git(root, 'init', '-q');
    makeRepo(root, smallFiles([`${name}/top.ts`, `a/b/${name}/deep.ts`, 'a/b/ok.ts']));
    git(root, 'add', '.');
    expect(sourceFiles(root)).toEqual(['a/b/ok.ts']);
  },
);

test.each(OUTPUT_DIRS)(
  'uses git: a tracked file below the output directory %s is kept at the top and nested',
  (name) => {
    const root = tempDir();
    git(root, 'init', '-q');
    makeRepo(root, smallFiles([`${name}/top.ts`, `src/${name}/deep.ts`, 'ok.ts']));
    git(root, 'add', '.');
    expect(sourceFiles(root)).toEqual(['ok.ts', `${name}/top.ts`, `src/${name}/deep.ts`].sort(compareNames));
  },
);

test('git lists only the source extensions, and no empty entry from the final NUL', () => {
  const root = tempDir();
  git(root, 'init', '-q');
  makeRepo(root, smallFiles(['z.ts', 'a.ts', 'sub/c.tsx', 'notes.md', 'logo.png']));
  git(root, 'add', 'z.ts');
  expect(gitFiles(root)).toEqual(['a.ts', 'sub/c.tsx', 'z.ts']);
});

test('an empty repository lists nothing: the empty text after the final NUL is not a file name', () => {
  const root = tempDir();
  git(root, 'init', '-q');
  expect(gitFiles(root)).toEqual([]);
  expect(sourceFiles(root)).toEqual([]);
});

test('outside a repository git has no list and the plain walk answers instead', () => {
  const root = tempDir();
  makeRepo(root, smallFiles(['src/ok.ts', 'node_modules/x.ts', 'src/build/y.ts']));
  expect(gitFiles(root)).toBeUndefined();
  expect(sourceFiles(root)).toEqual(['src/ok.ts']);
});

test('when git cannot be run inside a repository, the list is the one the plain walk gives', () => {
  const files = smallFiles(['src/ok.ts', 'node_modules/x.ts', 'src/build/y.ts']);
  const root = tempDir();
  git(root, 'init', '-q');
  makeRepo(root, files);
  expect(sourceFiles(root)).toEqual(['src/build/y.ts', 'src/ok.ts']);
  vi.stubEnv('PATH', tempDir());
  expect(gitFiles(root)).toBeUndefined();
  expect(sourceFiles(root)).toEqual(['src/ok.ts']);
  const plain = tempDir();
  makeRepo(plain, files);
  expect(sourceFiles(root)).toEqual(sourceFiles(plain));
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
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: file inside a temp directory created by the test
    fs.writeFileSync(Buffer.concat([Buffer.from(`${root}/caf`), Buffer.from([0xe9]), Buffer.from('.ts')]), SMALL);
    expect(() => sourceFiles(root)).toThrow(CapsError);
    expect(() => sourceFiles(root)).toThrow(/^file name is not valid UTF-8: caf\ufffd\.ts$/u);
  },
);

test.skipIf(process.platform !== 'linux')('a non-source file with a bad name is ignored', () => {
  const root = tempDir();
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: file inside a temp directory created by the test
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
