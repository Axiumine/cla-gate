// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import { expect, test } from 'vitest';
import { parse } from 'yaml';
import { expression } from './test-support.ts';
import { checkWorkflow, formatViolation } from './workflow-guard.ts';

const SELF = '[self-hosted, Linux, X64]';
const CI = '.github/workflows/ci.yml';
const RELEASE = '.github/workflows/release.yml';

/** A workflow whose parts can be replaced; everything not replaced is valid for ci.yml. */
function workflow(parts: { on?: string; permissions?: string; job?: string } = {}): string {
  const on = parts.on ?? 'on: pull_request';
  const permissions = parts.permissions ?? 'permissions:\n  contents: read';
  const job = parts.job ?? `    runs-on: ${SELF}\n    timeout-minutes: 15`;
  return `${on}\n${permissions}\njobs:\n  build:\n${job}\n`;
}

/** The report lines for `text` as the file `file`. */
function lines(file: string, text: string): string[] {
  const parsed: unknown = parse(text);
  return checkWorkflow(file, parsed).map(formatViolation);
}

const R1_MESSAGE = 'runs-on must be the literal ubuntu-24.04 or the literal list [self-hosted, Linux, X64]';

test.each([
  ['ubuntu-24.04', '    runs-on: ubuntu-24.04'],
  ['a double-quoted ubuntu-24.04', '    runs-on: "ubuntu-24.04"'],
  ['a single-quoted ubuntu-24.04', "    runs-on: 'ubuntu-24.04'"],
  ['the flow list', `    runs-on: ${SELF}`],
  ['the block list', '    runs-on:\n      - self-hosted\n      - Linux\n      - X64'],
  ['the quoted flow list', '    runs-on: ["self-hosted", \'Linux\', "X64"]'],
  ['an anchored list', `    runs-on: &runner ${SELF}`],
])('R1 accepts %s', (_what, runsOn) => {
  expect(lines(CI, workflow({ job: `${runsOn}\n    timeout-minutes: 5` }))).toEqual([]);
});

test('R1 accepts an alias of an anchored list and an alias of a whole job', () => {
  const text = [
    'on: pull_request',
    'permissions:',
    '  contents: read',
    'jobs:',
    '  first: &first',
    `    runs-on: &runner ${SELF}`,
    '    timeout-minutes: 5',
    '  second:',
    '    runs-on: *runner',
    '    timeout-minutes: 5',
    '  third: *first',
  ].join('\n');
  expect(lines(CI, text)).toEqual([]);
});

test.each([
  ['ubuntu-latest', '    runs-on: ubuntu-latest', '"ubuntu-latest"'],
  ['another ubuntu', '    runs-on: ubuntu-22.04', '"ubuntu-22.04"'],
  ['macos', '    runs-on: macos-latest', '"macos-latest"'],
  ['a matrix expression', `    runs-on: ${expression('matrix.os')}`, `"${expression('matrix.os')}"`],
  [
    'the fork ternary (shortened in the report)',
    `    runs-on: ${expression("github.event.pull_request.head.repo.fork && 'ubuntu-24.04' || 'self-hosted'")}`,
    `"${expression("github.event.pull_request.head.repo.fork && 'ubuntu-24.04' || 'self-host").slice(0, -3)}...`,
  ],
  ['self-hosted alone', '    runs-on: self-hosted', '"self-hosted"'],
  ['lower-case labels', '    runs-on: [self-hosted, linux, x64]', '["self-hosted","linux","x64"]'],
  ['a shorter list', '    runs-on: [self-hosted, Linux]', '["self-hosted","Linux"]'],
  ['a longer list', '    runs-on: [self-hosted, Linux, X64, gpu]', '["self-hosted","Linux","X64","gpu"]'],
  ['the labels in another order', '    runs-on: [Linux, self-hosted, X64]', '["Linux","self-hosted","X64"]'],
  ['ubuntu-24.04 in a list', '    runs-on: [ubuntu-24.04]', '["ubuntu-24.04"]'],
  ['the group form', '    runs-on:\n      group: default', '{"group":"default"}'],
  ['the labels form', '    runs-on:\n      labels: [self-hosted]', '{"labels":["self-hosted"]}'],
  ['a trailing space', '    runs-on: "ubuntu-24.04 "', '"ubuntu-24.04 "'],
  ['a non-string label', '    runs-on: [self-hosted, Linux, 64]', '["self-hosted","Linux",64]'],
  ['a number', '    runs-on: 24', '24'],
  ['an empty value', '    runs-on:', 'null'],
  ['no runs-on at all', '    name: no runner', 'nothing'],
])('R1 rejects %s', (_what, runsOn, shown) => {
  expect(lines(CI, workflow({ job: `${runsOn}\n    timeout-minutes: 5` }))).toEqual([
    `${CI}: job "build": R1 ${R1_MESSAGE}, found ${shown}`,
  ]);
});

test.each([
  ['ubuntu-24.04', 'ubuntu-24.04', []],
  ['the self-hosted list', SELF, ['R2']],
  ['ubuntu-latest', 'ubuntu-latest', ['R2']],
  ['an expression', expression('matrix.os'), ['R2']],
])('R2 in release and scorecard files: %s gives %j', (_what, runner, rules) => {
  const text = workflow({ job: `    runs-on: ${runner}\n    timeout-minutes: 5` });
  for (const file of [
    RELEASE,
    '.github/workflows/release.yaml',
    '.github/workflows/scorecard.yml',
    '.github/workflows/scorecard.yaml',
    '.github/workflows/Release.YML',
  ]) {
    expect(lines(file, text).map((line) => /: (R\d) /.exec(line)?.[1])).toEqual(rules);
  }
});

test.each([
  ['release-please.yml'],
  ['release-notes.yml'],
  ['prerelease.yml'],
  ['publish-release.yaml'],
  ['scorecards.yml'],
  ['Scorecard-Weekly.YML'],
])('R2 also applies when release or scorecard is only part of the name: %s', (name) => {
  const text = workflow({ job: `    runs-on: ${SELF}\n    timeout-minutes: 5` });
  expect(lines(`.github/workflows/${name}`, text).map((line) => /: (R\d) /.exec(line)?.[1])).toEqual(['R2']);
});

test.each([['ci.yml'], ['deploy.yml'], ['relay.yaml']])('R2 leaves %s alone', (name) => {
  const text = workflow({ job: `    runs-on: ${SELF}\n    timeout-minutes: 5` });
  expect(lines(`.github/workflows/${name}`, text)).toEqual([]);
});

test.each([
  ['a string', 'on: pull_request_target', ['pull_request_target']],
  ['a list', 'on: [push, pull_request_target]', ['pull_request_target']],
  ['a block list', 'on:\n  - workflow_run', ['workflow_run']],
  ['a mapping', 'on:\n  pull_request_target:\n    types: [opened]', ['pull_request_target']],
  [
    'workflow_run with workflows',
    'on:\n  workflow_run:\n    workflows: [CI]\n    types: [completed]',
    ['workflow_run'],
  ],
  ['both', 'on: [workflow_run, pull_request_target]', ['workflow_run', 'pull_request_target']],
  ['another case', 'on: Pull_Request_Target', ['Pull_Request_Target']],
])('R3 rejects the trigger as %s', (_what, on, names) => {
  const result = lines(CI, workflow({ on }));
  expect(result).toEqual(names.map((name) => `${CI}: workflow: R3 trigger ${name} is forbidden`));
});

test.each([
  ['pull_request'],
  ['[push, pull_request, workflow_dispatch]'],
  ['\n  push:\n    branches: [main]\n  schedule:\n    - cron: "0 3 * * 1"'],
  ['{ pull_request: { paths: ["pull_request_target"] } }'],
  [''],
])('R3 accepts the triggers %j', (on) => {
  expect(lines(CI, workflow({ on: `on: ${on}` }))).toEqual([]);
});

test.each([
  ['missing', '    runs-on: ubuntu-24.04', 'nothing'],
  ['zero', '    runs-on: ubuntu-24.04\n    timeout-minutes: 0', '0'],
  ['negative', '    runs-on: ubuntu-24.04\n    timeout-minutes: -5', '-5'],
  ['a string', '    runs-on: ubuntu-24.04\n    timeout-minutes: "15"', '"15"'],
  [
    'an expression',
    `    runs-on: ubuntu-24.04\n    timeout-minutes: ${expression('vars.T')}`,
    `"${expression('vars.T')}"`,
  ],
  ['empty', '    runs-on: ubuntu-24.04\n    timeout-minutes:', 'null'],
  ['just above the cap', '    runs-on: ubuntu-24.04\n    timeout-minutes: 61', '61'],
  ["GitHub's default for hosted runners", '    runs-on: ubuntu-24.04\n    timeout-minutes: 360', '360'],
  ['absurdly large', '    runs-on: ubuntu-24.04\n    timeout-minutes: 100000', '100000'],
  ['infinite', '    runs-on: ubuntu-24.04\n    timeout-minutes: .inf', 'null'],
  ['not a number', '    runs-on: ubuntu-24.04\n    timeout-minutes: .nan', 'null'],
])('R4 rejects a timeout-minutes that is %s', (_what, job, shown) => {
  expect(lines(CI, workflow({ job }))).toEqual([
    `${CI}: job "build": R4 timeout-minutes must be a positive number of at most 60, found ${shown}`,
  ]);
});

test.each([['1'], ['15'], ['0.5'], ['60']])('R4 accepts timeout-minutes: %s', (minutes) => {
  expect(lines(CI, workflow({ job: `    runs-on: ubuntu-24.04\n    timeout-minutes: ${minutes}` }))).toEqual([]);
});

test('R4 and R1 are both reported, once each', () => {
  expect(lines(CI, workflow({ job: '    runs-on: ubuntu-latest' })).map((line) => /: (R\d) /.exec(line)?.[1])).toEqual([
    'R1',
    'R4',
  ]);
});

test('R6 rejects a job that calls a reusable workflow and does not also report R1 or R4', () => {
  const local = lines(CI, workflow({ job: '    uses: ./.github/workflows/other.yml' }));
  const remote = lines(CI, workflow({ job: '    uses: owner/repo/.github/workflows/x.yml@main' }));
  const expected = [`${CI}: job "build": R6 job-level uses (reusable workflows) is not supported by this guard`];
  expect(local).toEqual(expected);
  expect(remote).toEqual(expected);
});

const R7_TAIL =
  'is not supported by this guard: start containers through scripts/ci/ (random loopback port, docs/ci-runners.md)';

test.each([
  ['an image', '    container: node:24', ['container']],
  [
    'a privileged container with a bind mount',
    '    container:\n      image: node:24\n      options: --privileged -v /:/host',
    ['container'],
  ],
  [
    'a service with a fixed well-known port',
    '    services:\n      db:\n        image: postgres:18\n        ports: ["5432:5432"]',
    ['services'],
  ],
  ['both', '    container: node:24\n    services:\n      db:\n        image: postgres:18', ['container', 'services']],
  ['an empty value', '    services:', ['services']],
])('R7 rejects a job with %s, on any runner', (_what, extra, keys) => {
  for (const runner of ['ubuntu-24.04', SELF]) {
    const job = `    runs-on: ${runner}\n    timeout-minutes: 5\n${extra}`;
    expect(lines(CI, workflow({ job }))).toEqual(
      keys.map((key) => `${CI}: job "build": R7 job-level ${key} ${R7_TAIL}`),
    );
  }
});

test('R7 does not look at steps, and R6 still wins for a job that calls a reusable workflow', () => {
  const steps = '    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n      - run: echo container services';
  expect(lines(CI, workflow({ job: steps }))).toEqual([]);
  expect(lines(CI, workflow({ job: '    uses: ./.github/workflows/other.yml\n    container: node:24' }))).toHaveLength(
    1,
  );
});
