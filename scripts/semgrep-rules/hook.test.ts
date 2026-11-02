// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { expect, test } from 'vitest';
import { exists, findOnPath, readText, symlink, writeExecutable } from '../ci/lib/test-support.ts';
import { git, makeRepo, tempDir } from '../code-caps/test-support.ts';
import { ROOT, repoText } from './test-support.ts';

// E20-S01: runs the real pre-push pipeline of lefthook.yml with real Lefthook and real git, and a stub `yarn` that
// only records its arguments. The PATH holds the stub, git and sh, so Semgrep is on it only when the test puts it there.

const LEFTHOOK = path.join(ROOT, 'node_modules/lefthook/bin/index.js');

/** A repository with the real lefthook.yml, and the PATH directory with the stub `yarn` (and a stub `semgrep` on request). */
function setup(withSemgrep: boolean) {
  const repo = tempDir();
  makeRepo(repo, { 'lefthook.yml': repoText('lefthook.yml'), 'notes.txt': 'one\n' });
  git(repo, 'init', '--quiet');
  git(repo, 'add', '--all');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.org', 'commit', '--quiet', '--message', 'first');
  const bin = tempDir();
  const calls = path.join(bin, 'yarn-calls');
  writeExecutable(path.join(bin, 'yarn'), `#!/bin/sh\necho "$@" >> '${calls}'\n`);
  for (const tool of ['git', 'sh']) {
    symlink(findOnPath(tool), path.join(bin, tool));
  }
  if (withSemgrep) {
    writeExecutable(path.join(bin, 'semgrep'), '#!/bin/sh\nexit 0\n');
  }
  return { repo, bin, calls };
}

function prePush(repo: string, bin: string, exclude = '') {
  const env = { PATH: bin, HOME: repo, GIT_CONFIG_GLOBAL: os.devNull, LEFTHOOK_EXCLUDE: exclude };
  return spawnSync(process.execPath, [LEFTHOOK, 'run', 'pre-push'], { cwd: repo, env, encoding: 'utf8' });
}

test('with Semgrep on the PATH the pre-push hook runs yarn semgrep', () => {
  const { repo, bin, calls } = setup(true);
  expect(prePush(repo, bin).status).toBe(0);
  expect(readText(calls).split('\n')).toContain('semgrep');
});

test('without Semgrep on the PATH the hook skips that job and still runs the other checks', () => {
  const { repo, bin, calls } = setup(false);
  const result = prePush(repo, bin);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('semgrep (skip) by condition');
  expect(readText(calls).split('\n')).not.toContain('semgrep');
  expect(readText(calls).split('\n')).toContain('lint:eslint');
});

test('LEFTHOOK_EXCLUDE=trivy,semgrep, the sanctioned offline exception, leaves the job out by its name', () => {
  const { repo, bin, calls } = setup(true);
  expect(prePush(repo, bin, 'trivy,semgrep').status).toBe(0);
  expect(readText(calls).split('\n')).not.toContain('semgrep');
  expect(exists(calls)).toBe(true);
});

test('a finding makes the hook fail: yarn semgrep exiting non-zero stops the push', () => {
  const { repo, bin } = setup(true);
  writeExecutable(path.join(bin, 'yarn'), '#!/bin/sh\n[ "$1" = semgrep ] && exit 1\nexit 0\n');
  expect(prePush(repo, bin).status).not.toBe(0);
});
