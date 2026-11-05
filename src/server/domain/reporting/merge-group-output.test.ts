// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { renderCheckOutput } from './check-output.ts';
import { minimalCheckOutput } from './check-output-minimal.ts';
import type { CheckView, MergeGroupResult } from './check-view.ts';
import { InvalidIdError, InvalidShaError } from './encode.ts';
import { mergeGroupOutput, REMOVE_AND_ADD_HINT, UNDETERMINED_SUMMARY } from './merge-group-output.ts';

// E22-S01: what the Check Run of a merge queue's group says. Fixed sentences and numbers: a pull request is `PR 123` in a code span,
// never `#123`, and no name of any person is ever read.

const HEAD = '9b8a7c6d5e4f30211203f4e5d6c7b8a99a8b7c6d';

const RESULTS: readonly MergeGroupResult[] = [
  { state: 'passed', pullRequests: 1 },
  { state: 'passed', pullRequests: 25 },
  { state: 'failed', failing: [41] },
  { state: 'failed', failing: [41, 42, 43] },
  { state: 'undetermined' },
  { state: 'errored' },
];

test('the fixed sentence of a group whose pull requests could not be determined is the one the story names', () => {
  expect(UNDETERMINED_SUMMARY).toBe('Could not determine the pull requests in this merge group');
  expect(mergeGroupOutput(HEAD, { state: 'undetermined' })).toEqual({
    status: 'completed',
    conclusion: 'failure',
    title: 'CLA check failed',
    summary: 'Could not determine the pull requests in this merge group',
  });
});

test('the hint of a group whose evaluation died is the one the story names, and the run is a failure', () => {
  expect(REMOVE_AND_ADD_HINT).toBe('Remove the pull request from the merge queue and add it again');
  const output = mergeGroupOutput(HEAD, { state: 'errored' });
  expect(output).toMatchObject({ status: 'completed', conclusion: 'failure', title: 'CLA check could not complete' });
  expect(output.summary).toContain('Remove the pull request from the merge queue and add it again');
});

test('a group that passed is a success that names the commit and the number of pull requests it covers', () => {
  expect(mergeGroupOutput(HEAD, { state: 'passed', pullRequests: 1 })).toEqual({
    status: 'completed',
    conclusion: 'success',
    title: 'CLA check passed',
    summary: 'The pull request in this merge group is covered by the CLA.\n\nChecked commit 9b8a7c6.',
  });
  expect(mergeGroupOutput(HEAD, { state: 'passed', pullRequests: 7 }).summary).toBe(
    'All 7 pull requests in this merge group are covered by the CLA.\n\nChecked commit 9b8a7c6.',
  );
});

test('a group with pull requests that are not covered is a failure that lists them as `PR n` in code spans, in the order given', () => {
  const output = mergeGroupOutput(HEAD, { state: 'failed', failing: [42, 7] });
  expect(output).toMatchObject({ status: 'completed', conclusion: 'failure', title: 'CLA check failed' });
  expect(output.summary).toContain('- `PR 42`\n- `PR 7`');
  expect(output.summary).toContain('not covered by the CLA');
  expect(output.summary).toContain('Remove it from the merge queue');
});

test('the list of failing pull requests is cut at 50 entries with the line that says how many were left out', () => {
  const failing = Array.from({ length: 60 }, (_, index) => index + 1);
  const { summary } = mergeGroupOutput(HEAD, { state: 'failed', failing });
  expect(summary).toContain('- `PR 50`');
  expect(summary).not.toContain('`PR 51`');
  expect(summary).toContain('…and 10 more (list truncated)');
});

test.each(RESULTS)(
  'no output of the group says #123: a pull request is never written so that GitHub links it (%j)',
  (result) => {
    const { title, summary } = mergeGroupOutput(HEAD, result);
    expect(`${title}\n${summary}`).not.toContain('#');
    expect(`${title}\n${summary}`).not.toContain('@');
  },
);

test.each(RESULTS)(
  'the result %j is a completed run: the conclusion is success for a pass and failure for everything else',
  (result) => {
    const output = mergeGroupOutput(HEAD, result);
    expect(output.status).toBe('completed');
    expect(output.conclusion).toBe(result.state === 'passed' ? 'success' : 'failure');
  },
);

test.each([
  ['a SHA that is not a SHA', 'not-a-sha'],
  ['a SHA in capitals', HEAD.toUpperCase()],
  ['a SHA of 39 digits', HEAD.slice(1)],
])('a passed group with %s is refused: nothing but a full lower-case SHA is printed', (_name, sha) => {
  expect(() => mergeGroupOutput(sha, { state: 'passed', pullRequests: 1 })).toThrow(InvalidShaError);
});

test.each([[1.5], [Number.NaN], [Number.POSITIVE_INFINITY], [2 ** 53]])(
  'a pull request count or number of %s is refused: a rounded or non-numeric id is never printed',
  (value) => {
    expect(() => mergeGroupOutput(HEAD, { state: 'passed', pullRequests: value })).toThrow(InvalidIdError);
    expect(() => mergeGroupOutput(HEAD, { state: 'failed', failing: [value] })).toThrow(InvalidIdError);
  },
);

test.each(RESULTS)(
  'the view of the merge group renders as its own output, and so does the minimal one (%j)',
  (result) => {
    const view: CheckView = { kind: 'merge_group', headSha: HEAD, result };
    expect(renderCheckOutput(view)).toEqual(mergeGroupOutput(HEAD, result));
    expect(minimalCheckOutput(view)).toEqual(mergeGroupOutput(HEAD, result));
  },
);
