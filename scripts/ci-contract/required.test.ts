// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { expression } from '../ci/lib/test-support.ts';
import { requiredJobNames } from './required.ts';
import { workflowWithJobs } from './test-support.ts';
import { requiredJobProblems } from './workflow.ts';

// E20-S09: reading the required checks out of the project document, and judging ci.yml against them.

const FILE = '.github/workflows/ci.yml';

test.each([
  [
    'the bullet as it stands',
    '- Required status checks: `static` and `coverage` (not strict, so a branch need not be up to date).',
  ],
  ['the short wording', '- Required checks: `static` and `coverage` (exact job names; renaming one breaks the rule).'],
  ['a star bullet', '* Required status checks: `static`, `coverage`'],
  ['no bullet marker', 'Required status checks: `static`, `coverage`.'],
  ['bold with the colon outside', '- **Required status checks**: `static` and `coverage`'],
  ['bold with the colon inside', '- **Required status checks:** `static` and `coverage`'],
  ['indentation', '    - Required checks: `static`, `coverage`'],
])('%s lists static and coverage', (_label, line) => {
  expect(requiredJobNames(`# Title\n\n${line}\n- Linear history required.\n`)).toEqual(['static', 'coverage']);
});

test('a promotion adds a name to the same bullet and the order is kept', () => {
  const line = '- Required status checks: `static`, `coverage`, `semgrep` and `trivy` (not strict).';
  expect(requiredJobNames(line)).toEqual(['static', 'coverage', 'semgrep', 'trivy']);
});

test('only the sentence before the first parenthesis counts: a job named in the remark is not required', () => {
  const line =
    '- Required status checks: `static` (not strict; `coverage` is named here only as an example) and `trivy`.';
  expect(requiredJobNames(line)).toEqual(['static']);
});

test('names on several bullets are joined, without repeats', () => {
  const text = '- Required checks: `static`, `coverage`\n\ntext\n- Required status checks: `coverage`, `semgrep`\n';
  expect(requiredJobNames(text)).toEqual(['static', 'coverage', 'semgrep']);
});

test.each([
  ['an empty document', ''],
  ['backticks on other lines', '- Advisory checks: `postgres`\n- Run `static` first\n'],
  ['the phrase in the middle of a line', 'The Required status checks: `static` are set by the maintainer.'],
  ['a bullet with no code spans', '- Required status checks: static and coverage'],
  ['a different heading', '- Required reviews: `none`'],
])('%s names no required job', (_label, text) => {
  expect(requiredJobNames(text)).toEqual([]);
});

const STATIC_JOB = ['  static:', '    name: static', '    runs-on: ubuntu-24.04'];
const COVERAGE_JOB = ['  coverage:', '    name: coverage', '    runs-on: ubuntu-24.04'];

test('required jobs that exist under their exact name and have no job-level if are clean', () => {
  const workflow = workflowWithJobs(
    'push',
    ...STATIC_JOB,
    ...COVERAGE_JOB,
    '    steps:',
    '      - run: echo',
    '        if: false',
  );
  expect(requiredJobProblems(FILE, workflow, ['static', 'coverage'])).toEqual([]);
});

test('a job without a name: is known by its id, as GitHub names the check', () => {
  const workflow = workflowWithJobs('push', '  static:', '    runs-on: ubuntu-24.04');
  expect(requiredJobProblems(FILE, workflow, ['static'])).toEqual([]);
});

test('a renamed job is a missing required check, even when its id is still the old name', () => {
  const workflow = workflowWithJobs('push', '  static:', '    name: Static analysis', '    runs-on: ubuntu-24.04');
  expect(requiredJobProblems(FILE, workflow, ['static'])).toEqual([
    `${FILE}: the required check "static" has no job with that exact name`,
  ]);
});

test('every required job that is missing is reported, and the others are not', () => {
  const workflow = workflowWithJobs('push', ...STATIC_JOB);
  expect(requiredJobProblems(FILE, workflow, ['static', 'coverage', 'semgrep'])).toEqual([
    `${FILE}: the required check "coverage" has no job with that exact name`,
    `${FILE}: the required check "semgrep" has no job with that exact name`,
  ]);
});

test.each([
  ['an expression', expression("github.event_name == 'push'")],
  ['a plain condition', "github.ref == 'refs/heads/main'"],
  ['the literal true', 'true'],
  ['an empty value', ''],
])('a job-level if with %s is reported', (_label, condition) => {
  const workflow = workflowWithJobs(
    'push',
    '  coverage:',
    '    name: coverage',
    `    if: ${condition}`,
    '    runs-on: ubuntu-24.04',
  );
  expect(requiredJobProblems(FILE, workflow, ['coverage'])).toEqual([
    `${FILE}: the required job "coverage" (coverage) has a job-level if:, so it can be skipped and never report`,
  ]);
});

test.each([
  ['the bare function', 'always()'],
  ['an expression', expression('always()')],
  ['an expression without spaces', ['$', '{{always()}}'].join('')],
  ['spaces around it', '  always()  '],
])('a job-level if of %s cannot skip the job, so it is allowed', (_label, condition) => {
  const workflow = workflowWithJobs(
    'push',
    '  coverage:',
    '    name: coverage',
    `    if: ${JSON.stringify(condition)}`,
    '    runs-on: ubuntu-24.04',
  );
  expect(requiredJobProblems(FILE, workflow, ['coverage'])).toEqual([]);
});

test.each([
  ['always() with another condition', expression("always() && github.ref == 'refs/heads/main'")],
  ['not cancelled', expression('!cancelled()')],
  ['the literal text always', 'always'],
  ['the function with an argument', 'always(1)'],
])('a job-level if of %s can skip the job, so it is reported', (_label, condition) => {
  const workflow = workflowWithJobs(
    'push',
    '  coverage:',
    '    name: coverage',
    `    if: ${JSON.stringify(condition)}`,
    '    runs-on: ubuntu-24.04',
  );
  expect(requiredJobProblems(FILE, workflow, ['coverage'])).toEqual([
    `${FILE}: the required job "coverage" (coverage) has a job-level if:, so it can be skipped and never report`,
  ]);
});

const SKIPPED =
  'without a job-level if: always(), so it is skipped when one of them fails, and a skipped required check counts as passing';

test.each([
  ['one job as text', ['    needs: shards'], 'shards'],
  ['one job as a list', ['    needs: [shards]'], 'shards'],
  ['two jobs', ['    needs: [shards, build]'], 'shards, build'],
])(
  'a required job that needs %s and has no if is skipped when they fail, so it is reported',
  (_label, needs, listed) => {
    const workflow = workflowWithJobs(
      'push',
      '  coverage:',
      '    name: coverage',
      ...needs,
      '    runs-on: ubuntu-24.04',
    );
    expect(requiredJobProblems(FILE, workflow, ['coverage'])).toEqual([
      `${FILE}: the required job "coverage" (coverage) needs ${listed} ${SKIPPED}`,
    ]);
  },
);

test('an empty needs list waits for nothing, so no if is needed', () => {
  const workflow = workflowWithJobs(
    'push',
    '  coverage:',
    '    name: coverage',
    '    needs: []',
    '    runs-on: ubuntu-24.04',
  );
  expect(requiredJobProblems(FILE, workflow, ['coverage'])).toEqual([]);
});

const MERGE_JOB = [
  '  coverage:',
  '    name: coverage',
  '    needs: [shards, build]',
  `    if: ${expression('always()')}`,
  '    runs-on: ubuntu-24.04',
  '    steps:',
];

test('a required job that runs always() and reads the result of every job it needs is clean, wherever the step reads it', () => {
  const workflow = workflowWithJobs(
    'push',
    ...MERGE_JOB,
    '      - run: echo "$RESULT"',
    '        env:',
    `          RESULT: ${expression('needs.shards.result')}`,
    '      - run: exit 1',
    `        if: ${expression("needs.build.result != 'success'")}`,
  );
  expect(requiredJobProblems(FILE, workflow, ['coverage'])).toEqual([]);
});

test('a required job that runs always() but never reads the result of a job it needs passes when that job fails, so it is reported', () => {
  const workflow = workflowWithJobs(
    'push',
    ...MERGE_JOB,
    '      - run: echo "$RESULT"',
    '        env:',
    `          RESULT: ${expression('needs.shards.result')}`,
  );
  expect(requiredJobProblems(FILE, workflow, ['coverage'])).toEqual([
    `${FILE}: the required job "coverage" (coverage) runs with always() but no step reads needs.build.result, so it passes when build fails`,
  ]);
});

test('a required job that runs always() and has no steps reads no result, so every job it needs is reported', () => {
  const workflow = workflowWithJobs(
    'push',
    '  coverage:',
    '    name: coverage',
    '    needs: shards',
    '    if: always()',
  );
  expect(requiredJobProblems(FILE, workflow, ['coverage'])).toEqual([
    `${FILE}: the required job "coverage" (coverage) runs with always() but no step reads needs.shards.result, so it passes when shards fails`,
  ]);
});

test('two jobs with the same name are both judged: a skippable twin is reported by its id', () => {
  const workflow = workflowWithJobs(
    'push',
    '  one:',
    '    name: static',
    '    runs-on: ubuntu-24.04',
    '  two:',
    '    name: static',
    '    if: false',
    '    runs-on: ubuntu-24.04',
  );
  expect(requiredJobProblems(FILE, workflow, ['static'])).toEqual([
    `${FILE}: the required job "static" (two) has a job-level if:, so it can be skipped and never report`,
  ]);
});

test.each([
  ['no jobs', 'on: push\n'],
  ['jobs that are a list', 'on: push\njobs: [static]\n'],
  ['a job name that is not text', workflowWithJobs('push', '  static:', '    name: [a]')],
  ['text that is not a workflow', 'just words'],
])('%s leaves the required check missing', (_label, workflow) => {
  expect(requiredJobProblems(FILE, workflow, ['static'])).toEqual([
    `${FILE}: the required check "static" has no job with that exact name`,
  ]);
});
