// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { exists, readText } from '../ci/lib/test-support.ts';
import { makeRepo, tempDir } from '../code-caps/test-support.ts';
import { compareNames } from '../code-caps/types.ts';
import { loadModule, systemFiles } from './system.ts';

// E20-S07: the real module loader and file system behind the wrapper, against a temp directory.

test('a scenario file is imported by its path, and its default export is what the module exports', async () => {
  const root = tempDir();
  makeRepo(root, { 'one.mjs': 'export default { name: "one", url: () => "u" };\n' });
  const loaded = await loadModule(path.join(root, 'one.mjs'));
  expect(loaded).toMatchObject({ default: { name: 'one' } });
});

test('a file that does not exist makes the import fail', async () => {
  await expect(loadModule(path.join(tempDir(), 'missing.mjs'))).rejects.toThrow();
});

test('the directory listing holds the names of the files in it', () => {
  const root = tempDir();
  makeRepo(root, { 'b.ts': '', 'a.ts': '', 'notes.md': '' });
  expect(systemFiles.list(root).toSorted(compareNames)).toEqual(['a.ts', 'b.ts', 'notes.md']);
});

test('listing a directory that does not exist fails', () => {
  expect(() => systemFiles.list(path.join(tempDir(), 'nope'))).toThrow(/ENOENT/);
});

test('a nested directory is made in one call, and making it again is not an error', () => {
  const root = tempDir();
  const nested = path.join(root, 'reports', 'leaks', 'canary', 'memlab');
  systemFiles.makeDirectory(nested);
  systemFiles.makeDirectory(nested);
  expect(exists(nested)).toBe(true);
});

test('a file is written with the text it was given', () => {
  const root = tempDir();
  const file = path.join(root, 'leaks.json');
  systemFiles.write(file, '[]\n');
  expect(readText(file)).toBe('[]\n');
});
