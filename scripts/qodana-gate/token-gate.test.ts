// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { expect, test } from 'vitest';
import { findOnPath, readText } from '../ci/lib/test-support.ts';
import { makeRepo, tempDir } from '../code-caps/test-support.ts';
import { ciJob } from '../semgrep-rules/test-support.ts';

// E20-S08: the two steps of the `qodana` job that hold shell logic, run for real in bash: the first step, which decides
// whether Qodana can run at all, and the check of the lcov report. The variables are the ones the workflow expressions
// produce: HAS_TOKEN and FORK_PR are the text 'true' or 'false'.

const job = ciJob('qodana');

function script(prefix: string): string {
  const found = job.steps.find((candidate) => candidate.name.startsWith(prefix))?.run;
  if (found === undefined) {
    throw new Error(`the qodana job has no run step starting with ${prefix}`);
  }
  return found;
}

/** Runs the gate step and returns what it printed and what it wrote to GITHUB_OUTPUT. */
function gate(variables: Readonly<Record<string, string>>) {
  const directory = tempDir();
  const output = path.join(directory, 'github-output');
  makeRepo(directory, { 'github-output': '' });
  const result = spawnSync(
    findOnPath('bash'),
    ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script('Check whether Qodana can run')],
    { env: { PATH: String(process.env['PATH']), GITHUB_OUTPUT: output, ...variables }, encoding: 'utf8' },
  );
  return { status: result.status, out: result.stdout, written: readText(output) };
}

test('a token and a branch of this repository: Qodana can run, and the step says nothing', () => {
  const result = gate({ HAS_TOKEN: 'true', FORK_PR: 'false' });
  expect(result).toEqual({ status: 0, out: '', written: 'available=true\n' });
});

test('no token: every later step is skipped, a notice names QODANA_TOKEN, and the step itself succeeds', () => {
  const result = gate({ HAS_TOKEN: 'false', FORK_PR: 'false' });
  expect(result.status).toBe(0);
  expect(result.written).toBe('available=false\n');
  expect(result.out).toMatch(/^::notice title=Qodana skipped::the secret QODANA_TOKEN is not set /);
  expect(result.out).toContain('this is not a failure');
  expect(result.out.trim().split('\n')).toHaveLength(1);
});

test('a fork pull request: skipped with a notice that says why, even when a token were visible', () => {
  const result = gate({ HAS_TOKEN: 'true', FORK_PR: 'true' });
  expect(result.status).toBe(0);
  expect(result.written).toBe('available=false\n');
  expect(result.out).toMatch(/^::notice title=Qodana skipped::this pull request comes from a fork /);
  expect(result.out).toContain('never blocks a contributor');
});

test('a fork pull request without a token gets the fork notice, and only one notice', () => {
  const result = gate({ HAS_TOKEN: 'false', FORK_PR: 'true' });
  expect(result.written).toBe('available=false\n');
  expect(result.out.trim().split('\n')).toHaveLength(1);
  expect(result.out).toContain('comes from a fork');
});

test.each([
  ['an empty value', ''],
  ['the word yes', 'yes'],
  ['a capital letter', 'True'],
  ['a trailing space', 'true '],
])('a HAS_TOKEN that is not exactly true (%s) never counts as a token', (_what, value) => {
  const result = gate({ HAS_TOKEN: value, FORK_PR: 'false' });
  expect(result.written).toBe('available=false\n');
  expect(result.out).toContain('QODANA_TOKEN is not set');
});

test('a FORK_PR that is not exactly true is not a fork, and the token decides', () => {
  expect(gate({ HAS_TOKEN: 'true', FORK_PR: '' }).written).toBe('available=true\n');
  expect(gate({ HAS_TOKEN: 'true', FORK_PR: 'false' }).written).toBe('available=true\n');
});

/** Runs the lcov check in a directory that holds `files`. */
function lcovCheck(files: Readonly<Record<string, string>>) {
  const directory = tempDir();
  makeRepo(directory, files);
  const result = spawnSync(
    findOnPath('bash'),
    ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script('Check the lcov report')],
    { cwd: directory, env: { PATH: String(process.env['PATH']) }, encoding: 'utf8' },
  );
  return { status: result.status, out: result.stdout };
}

const REPORT = '.qodana/code-coverage/lcov.info';
const GOOD = 'TN:\nSF:src/a.ts\nDA:1,1\nend_of_record\nTN:\nSF:scripts/b.ts\nDA:1,1\nend_of_record\n';

test('a report with source files under relative paths passes and says how many', () => {
  const result = lcovCheck({ [REPORT]: GOOD });
  expect(result.status).toBe(0);
  expect(result.out).toBe('coverage report: 2 source files\n');
});

test('no report at all fails the job at once and says what is wrong', () => {
  const result = lcovCheck({ 'unrelated.txt': 'x' });
  expect(result.status).toBe(1);
  expect(result.out).toContain('::error title=Qodana coverage::.qodana/code-coverage/lcov.info is missing or empty');
});

test('an empty report fails the same way', () => {
  const result = lcovCheck({ [REPORT]: '' });
  expect(result.status).toBe(1);
  expect(result.out).toContain('is missing or empty');
});

test('a report that lists no source file fails', () => {
  const result = lcovCheck({ [REPORT]: 'TN:\nend_of_record\n' });
  expect(result.status).toBe(1);
  expect(result.out).toContain('lists no source file (no SF: line)');
});

test.each([
  ['the only entry', 'TN:\nSF:/home/runner/work/cla/cla/src/a.ts\nend_of_record\n'],
  ['one entry among relative ones', `${GOOD}SF:/abs/c.ts\nend_of_record\n`],
])('absolute paths (%s) fail the job: Qodana could not match them to its files', (_what, report) => {
  const result = lcovCheck({ [REPORT]: report });
  expect(result.status).toBe(1);
  expect(result.out).toContain('has absolute paths');
  expect(result.out).toContain('relative to the repository root');
});

test('a slash later in the line is not an absolute path', () => {
  expect(lcovCheck({ [REPORT]: 'SF:src/a/b.ts\nend_of_record\n' }).status).toBe(0);
});
