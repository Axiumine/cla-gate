// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { expect, test } from 'vitest';
import { findOnPath, readText, symlink, writeExecutable } from '../ci/lib/test-support.ts';
import { git, makeRepo, tempDir } from '../code-caps/test-support.ts';
import { ROOT, repoText } from '../semgrep-rules/test-support.ts';

// E20-S02: runs the real pre-commit and pre-push pipelines of lefthook.yml with real Lefthook and real git, and a stub
// `yarn` that records its arguments. The PATH holds only the stub, git and sh: there is no Trivy on it, which is how an
// operator without Trivy sees the hooks.

const LEFTHOOK = path.join(ROOT, 'node_modules/lefthook/bin/index.js');

/** A repository with the real lefthook.yml, one staged TypeScript file, and a PATH directory with a stub `yarn`. */
function setup(yarnScript = '') {
  const repo = tempDir();
  makeRepo(repo, { 'lefthook.yml': repoText('lefthook.yml'), 'notes.txt': 'one\n' });
  git(repo, 'init', '--quiet');
  git(repo, 'add', '--all');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.org', 'commit', '--quiet', '--message', 'first');
  makeRepo(repo, { 'a.ts': 'export const a = 1;\n' });
  git(repo, 'add', 'a.ts');
  const bin = tempDir();
  const calls = path.join(bin, 'yarn-calls');
  writeExecutable(path.join(bin, 'yarn'), `#!/bin/sh\necho "$@" >> '${calls}'\n${yarnScript}`);
  for (const tool of ['git', 'sh']) {
    symlink(findOnPath(tool), path.join(bin, tool));
  }
  return { repo, bin, calls };
}

function run(hook: 'pre-commit' | 'pre-push', repo: string, bin: string, exclude = '') {
  const env = { PATH: bin, HOME: repo, GIT_CONFIG_GLOBAL: os.devNull, LEFTHOOK_EXCLUDE: exclude };
  return spawnSync(process.execPath, [LEFTHOOK, 'run', hook], { cwd: repo, env, encoding: 'utf8' });
}

const calledWith = (calls: string) => readText(calls).split('\n');

test('pre-commit runs yarn trivy:secrets, even though there is no Trivy on the PATH: the job has no missing-binary skip', () => {
  const { repo, bin, calls } = setup();
  const result = run('pre-commit', repo, bin);
  expect(result.status).toBe(0);
  expect(calledWith(calls)).toContain('trivy:secrets');
  expect(result.stdout).not.toContain('trivy (skip)');
});

test('pre-push runs yarn trivy, even though there is no Trivy on the PATH: the job has no missing-binary skip', () => {
  const { repo, bin, calls } = setup();
  const result = run('pre-push', repo, bin);
  expect(result.status).toBe(0);
  expect(calledWith(calls)).toContain('trivy');
  expect(result.stdout).not.toContain('trivy (skip)');
});

test('a secret found at commit time stops the commit', () => {
  const { repo, bin } = setup('[ "$1" = trivy:secrets ] && exit 1\nexit 0\n');
  expect(run('pre-commit', repo, bin).status).not.toBe(0);
});

test('a vulnerability, secret or misconfiguration found at push time stops the push', () => {
  const { repo, bin } = setup('[ "$1" = trivy ] && exit 1\nexit 0\n');
  expect(run('pre-push', repo, bin).status).not.toBe(0);
});

test('LEFTHOOK_EXCLUDE=trivy,semgrep, the sanctioned offline exception, leaves both trivy jobs out by their name', () => {
  const commit = setup();
  expect(run('pre-commit', commit.repo, commit.bin, 'trivy,semgrep').status).toBe(0);
  expect(calledWith(commit.calls)).not.toContain('trivy:secrets');
  const push = setup();
  expect(run('pre-push', push.repo, push.bin, 'trivy,semgrep').status).toBe(0);
  expect(calledWith(push.calls)).not.toContain('trivy');
  expect(calledWith(push.calls)).toContain('lint:eslint');
});

test('the dev-dependency pass and the secret-only script are not part of pre-push, and yarn trivy is not part of pre-commit', () => {
  const commit = setup();
  run('pre-commit', commit.repo, commit.bin);
  expect(calledWith(commit.calls)).not.toContain('trivy');
  const push = setup();
  run('pre-push', push.repo, push.bin);
  expect(calledWith(push.calls)).not.toContain('trivy:dev');
  expect(calledWith(push.calls)).not.toContain('trivy:secrets');
});
