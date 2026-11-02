// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from 'vitest';
import { findOnPath, readText, writeExecutable } from '../ci/lib/test-support.ts';
import { tempDir } from '../code-caps/test-support.ts';
import { ciJob, ciTextOnSharedRunners, ciTextWithoutJobToken, listDir, repoText } from './test-support.ts';

// E20-S01: the `semgrep` job of .github/workflows/ci.yml, and its install step run for real in bash against a stub pipx.

const job = ciJob('semgrep');
const INSTALL = 'Install Semgrep (pinned, in the runner temp directory)';
const names = job.steps.map((step) => step.name);

/** The script of a step of the job; the failure names the step. */
function stepRun(name: string): string {
  const run = job.steps.find((step) => step.name === name)?.run;
  if (run === undefined) {
    throw new Error(`the semgrep job has no script step ${name}`);
  }
  return run;
}

const pinned = /pipx install semgrep==(\d+\.\d+\.\d+)$/m.exec(stepRun(INSTALL))?.[1];

test('the job is named semgrep, has no needs, runs on the shared self-hosted runners and has a timeout', () => {
  expect(job.name).toBe('semgrep');
  expect(job.needs).toBeUndefined();
  expect(job['runs-on']).toEqual(['self-hosted', 'Linux', 'X64']);
  expect(job['timeout-minutes']).toBeGreaterThan(0);
  expect(job['timeout-minutes']).toBeLessThanOrEqual(20);
});

test('the job asks for no more than contents: read and holds no secret', () => {
  const text = repoText('.github/workflows/ci.yml');
  expect(job.permissions).toBeUndefined();
  expect(job.env).toBeUndefined();
  expect(text).toMatch(/^permissions:\n {2}contents: read\n/m);
  // The qodana job (E20-S08) holds a secret and runs on a GitHub-hosted machine: it is not part of this check.
  expect(ciTextOnSharedRunners()).not.toMatch(/\$\{\{\s*secrets\./);
  // The one exception is the read-only job token of the mutation job's `decide` step (E20-S04).
  expect(ciTextWithoutJobToken()).not.toMatch(/\bGITHUB_TOKEN\b/);
});

test('the scan can neither be skipped nor fail softly: no condition and no continue-on-error anywhere in the job', () => {
  expect(job.if).toBeUndefined();
  for (const step of job.steps) {
    expect(step.if).toBeUndefined();
    expect(step['continue-on-error']).toBeUndefined();
  }
  expect(job.steps.at(-1)).toMatchObject({ name: 'Semgrep (security scan)', run: 'yarn semgrep' });
});

test('Semgrep is installed after the standard Node, Corepack and yarn install steps, and runs last', () => {
  expect(names).toEqual([
    'Preflight (runner capabilities)',
    'Keep tool state in the runner temp directory',
    'Check out the repository',
    'Set up Node.js (version from .nvmrc)',
    'Enable Corepack',
    'Restore the Yarn cache',
    'Install dependencies',
    INSTALL,
    'Semgrep (security scan)',
  ]);
  expect(job.steps.find((step) => step.name === 'Install dependencies')?.run).toBe('yarn install --immutable');
});

test('the checkout drops its credentials and cleans the workspace', () => {
  const checkout = job.steps.find((step) => step.name === 'Check out the repository');
  expect(checkout?.with).toMatchObject({ 'persist-credentials': false, clean: true });
});

test('the pinned Semgrep version is an exact release and is the same in mise.toml', () => {
  expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  expect(repoText('mise.toml')).toContain(`"pipx:semgrep" = "${pinned}"`);
  expect(stepRun(INSTALL).match(/semgrep==/g)).toHaveLength(1);
});

/** Runs the install step in bash with a stub pipx that records its environment and creates a stub semgrep. */
function install(pipxExit = 0) {
  const temp = tempDir();
  const home = tempDir();
  const bin = tempDir();
  const files = {
    env: path.join(temp, 'github-env'),
    path: path.join(temp, 'github-path'),
    log: path.join(bin, 'calls'),
  };
  const stub = [
    '#!/bin/sh',
    `echo "pipx $* | PIPX_HOME=$PIPX_HOME PIPX_BIN_DIR=$PIPX_BIN_DIR PIPX_MAN_DIR=$PIPX_MAN_DIR" >> '${files.log}'`,
    'mkdir -p "$PIPX_BIN_DIR"',
    'printf \'#!/bin/sh\\necho 1.0.0\\n\' > "$PIPX_BIN_DIR/semgrep"',
    'chmod +x "$PIPX_BIN_DIR/semgrep"',
    `exit ${pipxExit}`,
    '',
  ].join('\n');
  writeExecutable(path.join(bin, 'pipx'), stub);
  const env = {
    PATH: `${bin}${path.delimiter}${path.dirname(findOnPath('bash'))}`,
    HOME: home,
    RUNNER_TEMP: temp,
    GITHUB_ENV: files.env,
    GITHUB_PATH: files.path,
  };
  const result = spawnSync(findOnPath('bash'), ['--noprofile', '--norc', '-eo', 'pipefail', '-c', stepRun(INSTALL)], {
    env,
    encoding: 'utf8',
  });
  return { temp, home, files, result };
}

test('the install step runs pipx with the pinned version and keeps every directory in the runner temp directory', () => {
  const { temp, files, result } = install();
  expect(result.status).toBe(0);
  const base = `${temp}/semgrep`;
  expect(readText(files.log).trim()).toBe(
    `pipx install semgrep==${pinned} | PIPX_HOME=${base}/pipx PIPX_BIN_DIR=${base}/bin PIPX_MAN_DIR=${base}/man`,
  );
});

test('the install step leaves the runner user home directory empty', () => {
  const { home, result } = install();
  expect(result.status).toBe(0);
  expect(listDir(home)).toEqual([]);
});

test('the install step sends Semgrep own settings and log to the runner temp directory and puts the binary on the PATH', () => {
  const { temp, files, result } = install();
  expect(result.stdout.trim()).toBe('1.0.0');
  expect(readText(files.env).trim().split('\n')).toEqual([
    `SEMGREP_SETTINGS_FILE=${temp}/semgrep/settings.yml`,
    `SEMGREP_LOG_FILE=${temp}/semgrep/semgrep.log`,
  ]);
  expect(readText(files.path)).toBe(`${temp}/semgrep/bin\n`);
});

test('a failing pipx fails the step, so the job never reaches the scan', () => {
  const { result } = install(1);
  expect(result.status).toBe(1);
});
