// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parse } from 'yaml';
import { checkWorkflow, formatViolation, WorkflowError } from './workflow-guard.ts';

const CI = '.github/workflows/ci.yml';
const RELEASE = '.github/workflows/release.yml';
const SCORECARD = '.github/workflows/scorecard.yaml';
const JOB = '  build:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n';
const TOP = `${CI}: workflow: R5 top-level`;

/** The report lines for a workflow with the given permissions block and jobs, as the file `file`. */
function lines(file: string, permissions: string, jobs = JOB): string[] {
  const parsed: unknown = parse(`on: push\n${permissions}\njobs:\n${jobs}`);
  return checkWorkflow(file, parsed).map(formatViolation);
}

test.each([
  ['contents: read only', 'permissions:\n  contents: read', CI],
  ['contents: read with quoted words', 'permissions:\n  "contents": "read"', CI],
  ['security-events: write in release', 'permissions:\n  contents: read\n  security-events: write', RELEASE],
  ['id-token: write in scorecard', 'permissions:\n  contents: read\n  id-token: write', SCORECARD],
  ['both extras in release', 'permissions:\n  contents: read\n  security-events: write\n  id-token: write', RELEASE],
])('R5 accepts %s', (_what, permissions, file) => {
  expect(lines(file, permissions)).toEqual([]);
});

test.each([
  ['missing', '', [`${TOP} permissions are missing: add "permissions: contents: read"`]],
  ['read-all', 'permissions: read-all', [`${TOP} permissions must be a mapping, found "read-all"`]],
  ['write-all', 'permissions: write-all', [`${TOP} permissions must be a mapping, found "write-all"`]],
  ['null', 'permissions:', [`${TOP} permissions must be a mapping, found null`]],
  ['an empty mapping', 'permissions: {}', [`${TOP} permissions need contents: read, found nothing`]],
  [
    'contents: write',
    'permissions:\n  contents: write',
    [`${TOP} permissions need contents: read, found "write"`, `${TOP} permission contents: "write" is not allowed`],
  ],
  [
    'an extra permission',
    'permissions:\n  contents: read\n  pull-requests: write',
    [`${TOP} permission pull-requests: "write" is not allowed`],
  ],
  [
    'release-only permissions in an ordinary file',
    'permissions:\n  contents: read\n  id-token: write\n  security-events: write',
    [`${TOP} permission id-token: "write" is not allowed`, `${TOP} permission security-events: "write" is not allowed`],
  ],
])('R5 rejects top-level permissions that are %s', (_what, permissions, expected) => {
  expect(lines(CI, permissions)).toEqual(expected);
});

test.each([
  ['id-token: read', 'permissions:\n  contents: read\n  id-token: read', 'id-token: "read"'],
  ['security-events: read', 'permissions:\n  contents: read\n  security-events: read', 'security-events: "read"'],
  ['packages: write', 'permissions:\n  contents: read\n  packages: write', 'packages: "write"'],
])('R5 rejects %s even in release files', (_what, permissions, shown) => {
  expect(lines(RELEASE, permissions)).toEqual([
    `${RELEASE}: workflow: R5 top-level permission ${shown} is not allowed`,
  ]);
});

test.each([
  ['an ordinary file', CI],
  ['a release file', RELEASE],
])('R5 rejects actions: read at the workflow level of %s: only a job may read the Actions API', (_what, file) => {
  expect(lines(file, 'permissions:\n  contents: read\n  actions: read')).toEqual([
    `${file}: workflow: R5 top-level permission actions: "read" is not allowed`,
  ]);
});

test('R5 still wants contents: read in a release file that only lists the extras', () => {
  expect(lines(RELEASE, 'permissions:\n  security-events: write')).toEqual([
    `${RELEASE}: workflow: R5 top-level permissions need contents: read, found nothing`,
  ]);
});

const GOOD = 'permissions:\n  contents: read';

function jobWith(permissions: string): string {
  return `${JOB}${permissions}`;
}

test.each([
  ['inherits the top level', ''],
  ['grants none', '    permissions: {}\n'],
  ['repeats contents: read', '    permissions:\n      contents: read\n'],
  ['reads the Actions API (E20-S04)', '    permissions:\n      actions: read\n      contents: read\n'],
  ['reads the Actions API and nothing else', '    permissions:\n      actions: read\n'],
])('R5 accepts a job that %s', (_what, permissions) => {
  expect(lines(CI, GOOD, jobWith(permissions))).toEqual([]);
});

test.each([
  ['write-all', '    permissions: write-all\n', 'permissions must be a mapping, found "write-all"'],
  ['contents: write', '    permissions:\n      contents: write\n', 'permission contents: "write" is not allowed'],
  [
    'id-token: write in an ordinary file',
    '    permissions:\n      id-token: write\n',
    'permission id-token: "write" is not allowed',
  ],
  ['actions: write', '    permissions:\n      actions: write\n', 'permission actions: "write" is not allowed'],
  ['actions: none', '    permissions:\n      actions: none\n', 'permission actions: "none" is not allowed'],
])('R5 rejects a job-level override that is %s', (_what, permissions, message) => {
  expect(lines(CI, GOOD, jobWith(permissions))).toEqual([`${CI}: job "build": R5 ${message}`]);
});

test('R5 lets a release job hold the release-only permissions', () => {
  const job = jobWith('    permissions:\n      id-token: write\n      security-events: write\n');
  expect(lines(RELEASE, GOOD, job)).toEqual([]);
});

test.each([
  ['an empty file', 'null'],
  ['a list', '[]'],
  ['a scalar', '"just text"'],
  ['jobs without triggers', 'jobs: {}'],
  ['triggers without jobs', 'on: push'],
  ['jobs that are a list', 'on: push\njobs: []'],
  ['jobs that are a scalar', 'on: push\njobs: nothing'],
])('%s is not a workflow', (_what, text) => {
  const parsed: unknown = parse(text);
  expect(() => checkWorkflow(CI, parsed)).toThrow(WorkflowError);
  expect(() => checkWorkflow(CI, parsed)).toThrow('not a workflow');
});

test.each([['build: ci'], ['build:'], ['build: [a, b]']])(
  'a job that is not a mapping (%s) is unusable input',
  (job) => {
    const parsed: unknown = parse(`on: push\npermissions:\n  contents: read\njobs:\n  ${job}\n`);
    expect(() => checkWorkflow(CI, parsed)).toThrow(new WorkflowError(`${CI}: job build is not a mapping`));
  },
);

test('a file or job name cannot forge a report line: control characters are escaped', () => {
  const text =
    'on: push\npermissions:\n  contents: read\njobs:\n  "a\\n::error::forged":\n    runs-on: nope\n    timeout-minutes: 5\n';
  const parsed: unknown = parse(text);
  const [line] = checkWorkflow('.github/workflows/x\u0007.yml', parsed).map(formatViolation);
  expect(line).toContain('.github/workflows/x\\x07.yml: job "a\\x0a::error::forged": R1 ');
  expect(line).not.toMatch(/\p{Cc}/u);
});
