// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { scriptProblems } from './package-scripts.ts';

// E20-S09: the five script contracts, each broken in the ways a careless edit or a hostile one would break it.

const GOOD: Readonly<Record<string, string>> = {
  semgrep: 'semgrep scan --config p/typescript --error --metrics off --disable-version-check',
  trivy:
    'trivy fs --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 . && trivy fs --scanners secret,misconfig --exit-code 1 .',
  mutate: 'stryker run --incremental',
  coverage: 'CI=1 vitest run --coverage',
};

/** A package.json text whose scripts are the good ones with `changes` applied (`undefined` removes a script). */
function manifest(changes: Readonly<Record<string, string | undefined>> = {}): string {
  const scripts = new Map(Object.entries({ ...GOOD, ...changes }));
  return JSON.stringify({
    name: 'demo',
    scripts: Object.fromEntries([...scripts].filter(([, value]) => value !== undefined)),
  });
}

test('the contracts hold for scripts that meet them', () => {
  expect(scriptProblems(manifest())).toEqual([]);
});

test.each([
  ['semgrep', 'the semgrep script'],
  ['trivy', 'the trivy script'],
  ['mutate', 'the mutate script'],
  ['coverage', 'the coverage script'],
])('a package.json without the %s script is reported (%s)', (name) => {
  expect(scriptProblems(manifest({ [name]: undefined }))).toEqual([`package.json has no ${name} script`]);
});

test.each([
  [
    'no --error',
    'semgrep scan --config p/typescript --metrics off',
    'the semgrep script needs --error, or findings exit 0',
  ],
  [
    '--error only inside another flag',
    'semgrep scan --no-error --metrics off',
    'the semgrep script needs --error, or findings exit 0',
  ],
  ['metrics left on', 'semgrep scan --error --metrics on', 'the semgrep script needs --metrics off'],
  ['metrics as one word', 'semgrep scan --error --metrics=off', 'the semgrep script needs --metrics off'],
  ['no metrics flag', 'semgrep scan --error', 'the semgrep script needs --metrics off'],
])('semgrep with %s is reported', (_label, script, expected) => {
  expect(scriptProblems(manifest({ semgrep: script }))).toEqual([expected]);
});

test('semgrep missing both flags gets both sentences, --error first', () => {
  expect(scriptProblems(manifest({ semgrep: 'semgrep scan --config p/typescript' }))).toEqual([
    'the semgrep script needs --error, or findings exit 0',
    'the semgrep script needs --metrics off',
  ]);
});

test.each([
  ['at the start', 'semgrep ci --error --metrics off'],
  ['after an and', 'semgrep scan --error --metrics off && semgrep ci'],
  ['after a pipe', 'echo x | semgrep ci'],
  ['after a semicolon', 'true; semgrep ci --config p/ci'],
  ['in a subshell', '(semgrep ci)'],
])('semgrep ci %s is reported', (_label, script) => {
  const problems = scriptProblems(manifest({ semgrep: script }));
  expect(problems).toContain(
    'the semgrep script runs semgrep ci, which ignores --config and targets the Semgrep platform',
  );
});

test('semgrep ci in a script of another name is reported under that name', () => {
  expect(scriptProblems(manifest({ 'scan:cloud': 'semgrep ci' }))).toEqual([
    'the scan:cloud script runs semgrep ci, which ignores --config and targets the Semgrep platform',
  ]);
});

test.each([['semgrep scan --config ci/rules.yml'], ['yarn semgrep ci-notes'], ['echo semgrepci'], ['mysemgrep ci']])(
  '%j is not a semgrep ci run',
  (script) => {
    expect(scriptProblems(manifest({ other: script }))).toEqual([]);
  },
);

const TRIVY_COUNTS = (passes: number, spelled: number) =>
  `the trivy script must run two passes that each spell --exit-code 1 (found ${passes} passes, ${spelled} spellings)`;

test.each([
  ['one pass', 'trivy fs --scanners vuln --exit-code 1 .', TRIVY_COUNTS(1, 1)],
  [
    'a second pass that does not spell the exit code',
    'trivy fs --scanners vuln --exit-code 1 . && trivy fs --scanners secret .',
    TRIVY_COUNTS(2, 1),
  ],
  ['an exit code of zero', 'trivy fs --exit-code 0 . && trivy fs --exit-code 1 .', TRIVY_COUNTS(2, 1)],
  ['an exit code of ten', 'trivy fs --exit-code 10 . && trivy fs --exit-code 1 .', TRIVY_COUNTS(2, 1)],
  ['the equals spelling', 'trivy fs --exit-code=1 . && trivy fs --exit-code 1 .', TRIVY_COUNTS(2, 1)],
  [
    'three passes',
    'trivy fs --exit-code 1 a && trivy fs --exit-code 1 b && trivy fs --exit-code 1 c',
    TRIVY_COUNTS(3, 3),
  ],
  ['both exit codes twice on one pass', 'trivy fs --exit-code 1 --exit-code 1 .', TRIVY_COUNTS(1, 2)],
  ['no passes', 'echo trivy', TRIVY_COUNTS(0, 0)],
])('trivy with %s is reported', (_label, script, expected) => {
  expect(scriptProblems(manifest({ trivy: script }))).toEqual([expected]);
});

test.each([
  ['the flag is absent', 'stryker run'],
  ['the flag is a prefix of another', 'stryker run --incrementalx'],
  ['the flag is attached to a value', 'stryker run --incremental=true'],
])('mutate where %s is reported', (_label, script) => {
  expect(scriptProblems(manifest({ mutate: script }))).toEqual(['the mutate script needs --incremental']);
});

test.each([
  ['the variable is missing', 'vitest run --coverage'],
  ['the variable comes later', 'vitest run CI=1 --coverage'],
  ['a longer value', 'CI=10 vitest run --coverage'],
  ['another variable ending in CI', 'NOCI=1 vitest run --coverage'],
  ['the variable is false', 'CI=0 vitest run --coverage'],
  ['no command follows', 'CI=1'],
])('coverage where %s is reported', (_label, script) => {
  expect(scriptProblems(manifest({ coverage: script }))).toEqual(['the coverage script must start with CI=1']);
});

test.each([['not json'], ['{"name":"demo"}'], ['{"scripts":{"a":1}}'], ['[]']])(
  'input %j is rejected, not passed',
  (text) => {
    expect(() => scriptProblems(text)).toThrow();
  },
);
