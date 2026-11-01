// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import process from 'node:process';
import { expect, test } from 'vitest';
import { collectIo } from '../../ci/lib/test-support.ts';
import { makeRepo, tempDir } from '../../code-caps/test-support.ts';
import { type HookDeps, installHooks, isCi, systemHookDeps } from './install-hooks.ts';

const ROOT = '/work/cla';

/** Fake dependencies: `.git` exists or not, and `lefthook install` exits with `code`; every run is recorded. */
function setup(hasGit: boolean, code = 0) {
  const runs: [string, readonly string[]][] = [];
  const deps: HookDeps = {
    exists: (file) => hasGit && file === path.join(ROOT, '.git'),
    run: (command, args) => {
      runs.push([command, args]);
      return Promise.resolve(code);
    },
  };
  return { deps, runs, ...collectIo() };
}

test.each([
  [undefined, false],
  ['', false],
  ['0', false],
  ['false', false],
  ['FALSE', false],
  [' false ', false],
  ['true', true],
  ['1', true],
  ['yes', true],
])('CI=%j means CI is %s', (value, expected) => {
  expect(isCi(value === undefined ? {} : { CI: value })).toBe(expected);
});

test.each([['true'], ['1']])(
  'with CI=%s no hook is installed, so a persistent workspace stays hook-free',
  async (ci) => {
    const { deps, runs, io, out } = setup(true);
    expect(await installHooks(ROOT, { CI: ci }, deps, io)).toBe(0);
    expect(runs).toEqual([]);
    expect(out).toEqual(['git hooks not installed: CI is set (docs/ci-runners.md, hygiene on a shared host)']);
  },
);

test('without a .git (a Docker build context) nothing is installed and the install still succeeds', async () => {
  const { deps, runs, io, out } = setup(false);
  expect(await installHooks(ROOT, {}, deps, io)).toBe(0);
  expect(runs).toEqual([]);
  expect(out).toEqual(['git hooks not installed: there is no .git here']);
});

test('on a developer machine it runs lefthook install and prints nothing itself', async () => {
  const { deps, runs, io, out } = setup(true);
  expect(await installHooks(ROOT, { CI: 'false' }, deps, io)).toBe(0);
  expect(runs).toEqual([['lefthook', ['install']]]);
  expect(out).toEqual([]);
});

test('a failing lefthook install fails the Yarn install with the same exit code', async () => {
  const { deps, io } = setup(true, 7);
  expect(await installHooks(ROOT, {}, deps, io)).toBe(7);
});

test('the real dependencies look for .git on disk and hand back the exit code of the command they run', async () => {
  const root = tempDir();
  expect(systemHookDeps.exists(path.join(root, '.git'))).toBe(false);
  makeRepo(root, { '.git': 'gitdir: elsewhere\n' });
  expect(systemHookDeps.exists(path.join(root, '.git'))).toBe(true);
  expect(await systemHookDeps.run(process.execPath, ['-e', 'process.exit(3)'])).toBe(3);
});
