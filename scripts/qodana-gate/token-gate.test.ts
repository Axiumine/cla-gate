// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { expect, test } from 'vitest';
import { findOnPath } from '../ci/lib/test-support.ts';
import { makeRepo, tempDir } from '../code-caps/test-support.ts';
import { ciJob } from '../semgrep-rules/test-support.ts';

// E20-S08: the steps of the `qodana` job that hold shell logic, run for real in bash: the first step, which requires the
// token and fails closed, the second, which requires the coverage job to have passed, and the check of the lcov report. The variables are the ones the workflow expressions produce:
// HAS_TOKEN and FORK_PR are the text 'true' or 'false'. The gate must never end green without a token, on any event: a
// required job that is skipped, or ends green, would let a pull request merge without the scan.

const job = ciJob('qodana');
const GATE = 'Require QODANA_TOKEN';

function script(prefix: string): string {
  const found = job.steps.find((candidate) => candidate.name.startsWith(prefix))?.run;
  if (found === undefined) {
    throw new Error(`the qodana job has no run step starting with ${prefix}`);
  }
  return found;
}

/** Runs the gate step in bash, as the runner does (`set -e` and pipefail), with exactly the variables given. */
function gate(variables: Readonly<Record<string, string>>) {
  const result = spawnSync(findOnPath('bash'), ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script(GATE)], {
    env: { PATH: String(process.env['PATH']), ...variables },
    encoding: 'utf8',
  });
  return { status: result.status, out: result.stdout, err: result.stderr };
}

/** Runs the step that requires the coverage job to have passed, with exactly the variables given. */
function coverageGuard(variables: Readonly<Record<string, string>>) {
  const result = spawnSync(
    findOnPath('bash'),
    ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script('Require the coverage job')],
    { env: { PATH: String(process.env['PATH']), ...variables }, encoding: 'utf8' },
  );
  return { status: result.status, out: result.stdout, err: result.stderr };
}

/** The annotation lines of the output: the step prints exactly one, or nothing. */
function lines(out: string): string[] {
  return out.split('\n').filter((line) => line !== '');
}

test('a token and a branch of this repository: the gate passes, and the step says nothing', () => {
  expect(gate({ HAS_TOKEN: 'true', FORK_PR: 'false' })).toEqual({ status: 0, out: '', err: '' });
});

test('no token: the step fails with one error annotation that names QODANA_TOKEN and says the job fails closed', () => {
  const result = gate({ HAS_TOKEN: 'false', FORK_PR: 'false' });
  expect(result.status).toBe(1);
  expect(result.err).toBe('');
  expect(lines(result.out)).toHaveLength(1);
  expect(result.out).toMatch(/^::error title=Qodana token missing::the secret QODANA_TOKEN is empty or not visible /);
  expect(result.out).toContain('Dependabot secret');
  expect(result.out).toContain('fails closed');
  expect(result.out).toContain('red instead of skipped');
});

test('a fork pull request: red, and the error says that forks get no secrets and what a maintainer does', () => {
  const result = gate({ HAS_TOKEN: 'false', FORK_PR: 'true' });
  expect(result.status).toBe(1);
  expect(lines(result.out)).toHaveLength(1);
  expect(result.out).toMatch(/^::error title=Qodana fork pull request::this pull request comes from a fork /);
  expect(result.out).toContain('no secrets');
  expect(result.out).toContain('QODANA_TOKEN');
  expect(result.out).toContain('push the branch into the repository');
  expect(result.out).not.toContain('token missing');
});

test('a fork pull request is red even when a token were visible: the fork rule does not depend on the token', () => {
  const result = gate({ HAS_TOKEN: 'true', FORK_PR: 'true' });
  expect(result.status).toBe(1);
  expect(lines(result.out)).toHaveLength(1);
  expect(result.out).toContain('title=Qodana fork pull request::');
});

test.each([
  ['an empty value', ''],
  ['the word yes', 'yes'],
  ['the number one', '1'],
  ['a capital letter', 'True'],
  ['a trailing space', 'true '],
  ['a leading space', ' true'],
  ['a line end', 'true\n'],
])('a HAS_TOKEN that is not exactly true (%s) never counts as a token', (_what, value) => {
  const result = gate({ HAS_TOKEN: value, FORK_PR: 'false' });
  expect(result.status).toBe(1);
  expect(lines(result.out)).toHaveLength(1);
  expect(result.out).toMatch(/^::error title=Qodana token missing::/);
});

test('unset variables are red with the same clear message, not "unbound variable" from set -u', () => {
  for (const variables of [{}, { FORK_PR: 'false' }, { HAS_TOKEN: 'false' }]) {
    const result = gate(variables);
    expect(result.status).toBe(1);
    expect(result.err).toBe('');
    expect(lines(result.out)).toHaveLength(1);
    expect(result.out).toMatch(/^::error title=Qodana token missing::the secret QODANA_TOKEN /);
  }
});

test('a FORK_PR that is not exactly true is not a fork: the token decides', () => {
  for (const fork of ['', 'false', 'True', '1', 'true ']) {
    expect(gate({ HAS_TOKEN: 'true', FORK_PR: fork })).toEqual({ status: 0, out: '', err: '' });
    expect(gate({ HAS_TOKEN: 'false', FORK_PR: fork }).out).toContain('title=Qodana token missing::');
  }
  expect(gate({ HAS_TOKEN: 'true' })).toEqual({ status: 0, out: '', err: '' });
});

test('the step has no way to end green without a token: no notice, no output file, no soft exit', () => {
  const text = script(GATE);
  expect(text).not.toContain('::notice');
  expect(text).not.toContain('::warning');
  expect(text).not.toContain('GITHUB_OUTPUT');
  expect(text).not.toMatch(/exit 0|\|\| true/);
  // Every error path exits non-zero, so the number of `exit 1` equals the number of error annotations.
  expect(text.match(/::error/g)).toHaveLength(2);
  expect(text.match(/exit 1/g)).toHaveLength(2);
});

test('the coverage job succeeded: the guard passes and says nothing', () => {
  expect(coverageGuard({ COVERAGE_RESULT: 'success' })).toEqual({ status: 0, out: '', err: '' });
});

test.each([
  ['failure', 'failure'],
  ['cancelled', 'cancelled'],
  ['skipped', 'skipped'],
  ['an empty result', ''],
  ['a capital letter', 'Success'],
  ['a trailing space', 'success '],
])('the coverage job ended as %s: the guard is red with one error that names the result', (_what, value) => {
  const result = coverageGuard({ COVERAGE_RESULT: value });
  expect(result.status).toBe(1);
  expect(result.err).toBe('');
  expect(lines(result.out)).toHaveLength(1);
  expect(result.out).toBe(
    `::error title=Qodana needs coverage::the coverage job ended as '${value}', not 'success', so there is no lcov report to scan; qodana is a required check and fails closed\n`,
  );
});

test('an unset result is red with the same message, not "unbound variable" from set -u', () => {
  const result = coverageGuard({});
  expect(result.status).toBe(1);
  expect(result.err).toBe('');
  expect(result.out).toContain("the coverage job ended as '', not 'success'");
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
