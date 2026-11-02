// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { SHA, workflowWithJobs, workflowWithSteps } from './test-support.ts';
import { workflowFileNames, workflowProblems } from './workflow.ts';

// E20-S09: the pinning and trigger rules of every workflow file, fed with the ways a `uses:` line can go wrong.

const FILE = '.github/workflows/ci.yml';
const NOT_PINNED = 'is not owner/repo@<40 hex digit commit SHA>';
const NEEDS_COMMENT = 'needs a trailing comment with its release, like "# v1.2.3"';

test('a step pinned by full SHA with a release comment is clean, with or without a subpath', () => {
  const workflow = workflowWithSteps(
    `uses: actions/checkout@${SHA} # v7.0.1`,
    `uses: github/codeql-action/init@${SHA}   #   v3.30.0  `,
    'run: echo ok',
  );
  expect(workflowProblems(FILE, workflow)).toEqual([]);
});

test.each([
  ['a tag', 'actions/checkout@v4'],
  ['a branch', 'actions/checkout@main'],
  ['a short SHA', 'actions/checkout@3d3c42e'],
  ['an upper case SHA', `actions/checkout@${SHA.toUpperCase()}`],
  ['a SHA with one digit too many', `actions/checkout@${SHA}0`],
  ['a SHA-256 length hash', `actions/checkout@${SHA}${SHA.slice(0, 24)}`],
  ['no ref at all', 'actions/checkout'],
  ['a docker image', 'docker://alpine:3.22'],
  ['an empty path segment', `owner/repo/@${SHA}`],
  ['a path that climbs out of the repository', `owner/repo/../other@${SHA}`],
  ['a dot segment', `owner/./repo@${SHA}`],
  ['two refs', `actions/checkout@${SHA}@${SHA}`],
  ['a name with a space', `actions/check out@${SHA}`],
  ['a repository without an owner', `checkout@${SHA}`],
])('%s is not a pinned action', (_label, value) => {
  const problems = workflowProblems(FILE, workflowWithSteps(`uses: ${value} # v1.2.3`));
  expect(problems).toEqual([`${FILE}: job "build" step 1: uses "${value}" ${NOT_PINNED}`]);
});

test.each([
  ['no comment', ''],
  ['a comment that is not a release', ' # main'],
  ['a release without a patch number', ' # v1.2'],
  ['a release without the v', ' # 1.2.3'],
  ['a release with a suffix', ' # v1.2.3-rc1'],
  ['an empty comment', ' #'],
])('a pinned action with %s needs a release comment', (_label, comment) => {
  const problems = workflowProblems(
    FILE,
    workflowWithSteps('run: echo before', `uses: actions/checkout@${SHA}${comment}`),
  );
  expect(problems).toEqual([`${FILE}: job "build" step 2: uses "actions/checkout@${SHA}" ${NEEDS_COMMENT}`]);
});

test('a release comment on the next line does not count: it must trail the uses line', () => {
  const workflow = [
    'on: push',
    'jobs:',
    '  build:',
    '    steps:',
    `      - uses: actions/checkout@${SHA}`,
    '        # v7.0.1',
    '',
  ].join('\n');
  expect(workflowProblems(FILE, workflow)).toEqual([
    `${FILE}: job "build" step 1: uses "actions/checkout@${SHA}" ${NEEDS_COMMENT}`,
  ]);
});

test('a comment in quotes or a quoted uses value is read for what it is', () => {
  const workflow = workflowWithSteps(`uses: "actions/checkout@${SHA}" # v7.0.1`, `uses: 'actions/cache@v6' # v6.1.0`);
  expect(workflowProblems(FILE, workflow)).toEqual([
    `${FILE}: job "build" step 2: uses "actions/cache@v6" ${NOT_PINNED}`,
  ]);
});

test('a path inside the action repository is part of the reference', () => {
  const workflow = workflowWithSteps(
    `uses: owner/repo/sub/dir@${SHA} # v1.0.0`,
    `uses: owner/repo/.github/x.yml@${SHA} # v1.0.0`,
  );
  expect(workflowProblems(FILE, workflow)).toEqual([]);
});

test('local actions are exempt, with or without a comment', () => {
  const workflow = workflowWithSteps('uses: ./.github/actions/setup', 'uses: ../shared/action # note');
  expect(workflowProblems(FILE, workflow)).toEqual([]);
});

test('a uses value that is not a string is reported as an empty reference', () => {
  const workflow = workflowWithSteps('uses: { name: checkout }');
  expect(workflowProblems(FILE, workflow)).toEqual([`${FILE}: job "build" step 1: uses "" ${NOT_PINNED}`]);
});

test('a reusable workflow called by a job is held to the same rule, and names the job', () => {
  const unpinned = workflowWithJobs('push', '  call:', '    uses: org/repo/.github/workflows/build.yml@main');
  const pinned = workflowWithJobs('push', '  call:', `    uses: org/repo/.github/workflows/build.yml@${SHA} # v1.0.0`);
  expect(workflowProblems(FILE, unpinned)).toEqual([
    `${FILE}: job "call" the job: uses "org/repo/.github/workflows/build.yml@main" ${NOT_PINNED}`,
  ]);
  expect(workflowProblems(FILE, pinned)).toEqual([]);
});

test('every unpinned use in every job is reported, in file order', () => {
  const workflow = workflowWithJobs(
    'push',
    '  first:',
    '    steps:',
    '      - uses: a/b@v1',
    '  second:',
    '    steps:',
    '      - run: echo',
    '      - uses: c/d@v2',
  );
  expect(workflowProblems(FILE, workflow)).toEqual([
    `${FILE}: job "first" step 1: uses "a/b@v1" ${NOT_PINNED}`,
    `${FILE}: job "second" step 2: uses "c/d@v2" ${NOT_PINNED}`,
  ]);
});

test.each([
  ['a job that is not a mapping', workflowWithJobs('push', '  odd: nothing')],
  ['steps that are not a list', workflowWithJobs('push', '  odd:', '    steps: none')],
  ['steps that are not mappings', workflowWithJobs('push', '  odd:', '    steps: [one, two]')],
  ['no jobs at all', 'on: push\n'],
  ['a jobs key that is a list', 'on: push\njobs: [a]\n'],
])('%s has no uses to judge', (_label, workflow) => {
  expect(workflowProblems(FILE, workflow)).toEqual([]);
});

test.each([
  ['a single event', 'pull_request_target'],
  ['a list of events', '[push, pull_request_target]'],
  ['a mapping with branches', '\n  pull_request_target:\n    branches: [main]'],
  ['a mapping with no settings', '\n  pull_request_target:'],
])('pull_request_target as %s is reported', (_label, on) => {
  const problems = workflowProblems(FILE, workflowWithJobs(on, '  a:', '    runs-on: ubuntu-24.04'));
  expect(problems).toEqual([
    `${FILE}: runs on pull_request_target, which gives a fork's pull request a token with write access`,
  ]);
});

test.each([
  ['a single event', 'pull_request'],
  ['a list of events', '[push, pull_request, workflow_dispatch]'],
  ['a mapping', '\n  push:\n  pull_request:\n    branches: [main]'],
  [
    'a name that only contains it',
    '\n  workflow_dispatch:\n    inputs:\n      pull_request_target:\n        type: boolean',
  ],
])('%s without pull_request_target is clean', (_label, on) => {
  expect(workflowProblems(FILE, workflowWithJobs(on, '  a:', '    runs-on: ubuntu-24.04'))).toEqual([]);
});

test.each([['jobs:\n  a:\n    steps: []\n'], ['on:\njobs: {}\n'], ['on: 7\njobs: {}\n']])(
  'a workflow without a usable trigger is not reported as pull_request_target: %j',
  (workflow) => {
    expect(workflowProblems(FILE, workflow)).toEqual([]);
  },
);

test('a unpinned action and pull_request_target are both reported, the action first', () => {
  const workflow = ['on: pull_request_target', 'jobs:', '  a:', '    steps:', '      - uses: x/y@main', ''].join('\n');
  expect(workflowProblems(FILE, workflow)).toEqual([
    `${FILE}: job "a" step 1: uses "x/y@main" ${NOT_PINNED}`,
    `${FILE}: runs on pull_request_target, which gives a fork's pull request a token with write access`,
  ]);
});

test('text that is not YAML is a problem, not a silent pass', () => {
  const problems = workflowProblems(FILE, 'on: push\njobs: [unclosed\n');
  expect(problems.length).toBeGreaterThan(0);
  expect(problems.every((problem) => problem.startsWith(`${FILE}: does not parse as YAML: `))).toBe(true);
  expect(problems.every((problem) => !problem.includes('\n'))).toBe(true);
});

test('the workflow files of a listing are the yml and yaml ones, in code point order', () => {
  const listing = ['scorecard.yml', 'README.md', 'ci.yaml', 'Release.yml', 'notes.yml.bak', 'ci.yml', 'yml', '.yml'];
  expect(workflowFileNames(listing)).toEqual(['.yml', 'Release.yml', 'ci.yaml', 'ci.yml', 'scorecard.yml']);
});
