// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { expect, test } from 'vitest';
import { exists, readText, writeExecutable } from '../ci/lib/test-support.ts';
import { git, makeRepo, tempDir } from '../code-caps/test-support.ts';

// Runs the post-checkout job of lefthook.yml for real: real Lefthook (its argument substitution is the point), real git,
// a stub `yarn` that only records that it was called.

const ROOT = path.resolve(import.meta.dirname, '../..');
const LEFTHOOK = path.join(ROOT, 'node_modules/lefthook/bin/index.js');

/** Two commits in a fresh repository; the second changes `changed`. Returns the directory and the stub's marker file. */
function repository(changed: string) {
  const repo = tempDir();
  const files = {
    'lefthook.yml': readText(path.join(ROOT, 'lefthook.yml')),
    'yarn.lock': 'one\n',
    'notes.txt': 'one\n',
  };
  makeRepo(repo, files);
  const commit = (message: string) => {
    git(repo, 'add', '--all');
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.org', 'commit', '--quiet', '--message', message);
  };
  git(repo, 'init', '--quiet');
  commit('first');
  makeRepo(repo, { [changed]: 'two\n' });
  commit('second');
  const bin = tempDir();
  const marker = path.join(bin, 'yarn-calls');
  writeExecutable(path.join(bin, 'yarn'), `#!/bin/sh\necho "$@" >> '${marker}'\n`);
  return { repo, bin, marker };
}

/** `lefthook run post-checkout HEAD~1 HEAD 1`: what git runs after `git checkout <branch>` moved HEAD by one commit. */
function postCheckout(repo: string, bin: string) {
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}`,
    GIT_CONFIG_GLOBAL: os.devNull,
  };
  return spawnSync(process.execPath, [LEFTHOOK, 'run', 'post-checkout', 'HEAD~1', 'HEAD', '1'], {
    cwd: repo,
    env,
    encoding: 'utf8',
  });
}

test('a checkout that changed yarn.lock reinstalls the dependencies', () => {
  const { repo, bin, marker } = repository('yarn.lock');
  expect(postCheckout(repo, bin).status).toBe(0);
  expect(readText(marker)).toBe('install --immutable\n');
});

test('a checkout that left the lockfile alone does not reinstall anything', () => {
  const { repo, bin, marker } = repository('notes.txt');
  expect(postCheckout(repo, bin).status).toBe(0);
  expect(exists(marker)).toBe(false);
});
