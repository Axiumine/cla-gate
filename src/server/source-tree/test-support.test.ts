// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { sourceTree } from './test-support.ts';

// The root a source scan takes (docs/tooling-gotchas.md, Stryker): the repository, and never the sandbox of a Stryker run.

test.each([
  ['a directory of the repository', '/work/cla/src/server', '/work/cla/src/server'],
  [
    'a directory in the sandbox of a Stryker run',
    '/work/cla/.stryker-tmp/sandbox-qoUfpC/src/server',
    '/work/cla/src/server',
  ],
  ['the sandbox itself', '/work/cla/.stryker-tmp/sandbox-qoUfpC', '/work/cla'],
  ['a sandbox on Windows', 'C:\\work\\cla\\.stryker-tmp\\sandbox-a1\\src', 'C:\\work\\cla\\src'],
  [
    'a temporary directory that holds no sandbox',
    '/work/cla/.stryker-tmp/cache/src',
    '/work/cla/.stryker-tmp/cache/src',
  ],
  [
    'a name that only starts like the temporary directory',
    '/work/.stryker-tmp-old/sandbox-a1/src',
    '/work/.stryker-tmp-old/sandbox-a1/src',
  ],
])('a test that scans the source takes the repository for %s', (_name, directory, expected) => {
  expect(sourceTree(directory)).toBe(expected);
});
