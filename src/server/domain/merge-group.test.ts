// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  detailsOfFailure,
  detailsOfMembers,
  MAX_MERGE_GROUP_COMMITS,
  MAX_MERGE_GROUP_PULL_REQUESTS,
  type MemberResult,
  mergeGroupDetailsSchema,
  resultOfMembers,
  tipPullRequestOf,
} from './merge-group.ts';

// The rules of a merge queue's group that need no I/O (E22-S01).

const SHA = '9b8a7c6d5e4f30211203f4e5d6c7b8a99a8b7c6d';
const member = (
  prNumber: number,
  outcome: 'success' | 'failure' = 'success',
  failureCodes: string[] = [],
): MemberResult => ({
  prNumber,
  outcome,
  failureCodes,
});

test('the limits are the ones the story names: 25 pull requests, and a range small enough to look up commit by commit', () => {
  expect(MAX_MERGE_GROUP_PULL_REQUESTS).toBe(25);
  expect(MAX_MERGE_GROUP_COMMITS).toBe(250);
});

test.each([
  [`refs/heads/gh-readonly-queue/main/pr-1-${SHA}`, 1],
  [`refs/heads/gh-readonly-queue/main/pr-123-${SHA}`, 123],
  [`refs/heads/gh-readonly-queue/main/pr-9999999999-${SHA}`, 9_999_999_999],
  [`refs/heads/gh-readonly-queue/release/2026/pr-9-${SHA}`, 9],
  [`refs/heads/gh-readonly-queue/feature/pr-1/pr-8-${SHA}`, 8],
])('the branch %s names pull request %s', (headRef, number) => {
  expect(tipPullRequestOf(headRef)).toBe(number);
});

test.each([
  ['', 'an empty name'],
  [`refs/heads/main`, 'a branch that is not a queue branch'],
  [`gh-readonly-queue/main/pr-1-${SHA}`, 'a name without refs/heads'],
  [`refs/heads/gh-readonly-queue/main/pr-0-${SHA}`, 'number zero'],
  [`refs/heads/gh-readonly-queue/main/pr-01-${SHA}`, 'a leading zero'],
  [`refs/heads/gh-readonly-queue/main/pr-12345678901-${SHA}`, 'a number of eleven digits'],
  [`refs/heads/gh-readonly-queue/main/pr--1-${SHA}`, 'a negative number'],
  [`refs/heads/gh-readonly-queue/main/pr-1.5-${SHA}`, 'a fraction'],
  [`refs/heads/gh-readonly-queue/main/pr-1-${SHA.toUpperCase()}`, 'a SHA in capitals'],
  [`refs/heads/gh-readonly-queue/main/pr-1-${SHA.slice(1)}`, 'a SHA of 39 digits'],
  [`refs/heads/gh-readonly-queue/main/pr-1-${SHA}0`, 'a SHA of 41 digits'],
  [`refs/heads/gh-readonly-queue/main/pr-1-${SHA}\n`, 'a trailing line break'],
  [`refs/heads/gh-readonly-queue//pr-1-${SHA}`, 'an empty base branch'],
  [`refs/heads/gh-readonly-queue/pr-1-${SHA}`, 'no base branch'],
  [`xrefs/heads/gh-readonly-queue/main/pr-1-${SHA}`, 'a prefix'],
])('%j (%s) names no pull request', (headRef) => {
  expect(tipPullRequestOf(headRef)).toBeUndefined();
});

test('a group passes only when every pull request does, and the count is the number of pull requests', () => {
  expect(resultOfMembers([member(1)])).toEqual({ state: 'passed', pullRequests: 1 });
  expect(resultOfMembers([member(1), member(2), member(3)])).toEqual({ state: 'passed', pullRequests: 3 });
});

test('a group with a pull request that fails fails, naming the ones that fail in the order they were given', () => {
  expect(resultOfMembers([member(3, 'failure'), member(1), member(2, 'failure')])).toEqual({
    state: 'failed',
    failing: [3, 2],
  });
});

test('a group with no pull request at all is not a pass: it is undetermined', () => {
  expect(resultOfMembers([])).toEqual({ state: 'undetermined' });
});

test('the details of a group of members keep the outcome of each, the codes of the failures and a success only when all pass', () => {
  expect(detailsOfMembers([member(1), member(2, 'failure', ['unsigned_contributor'])])).toEqual({
    version: 1,
    outcome: 'failure',
    pullRequests: [
      { number: 1, outcome: 'success', failureCodes: [] },
      { number: 2, outcome: 'failure', failureCodes: ['unsigned_contributor'] },
    ],
  });
  expect(detailsOfMembers([member(1)]).outcome).toBe('success');
  expect(detailsOfMembers([]).outcome).toBe('failure');
});

test('the details hold at most 25 pull requests and 20 codes of each, and a row stays small whatever it is given', () => {
  const codes = Array.from({ length: 30 }, (_, index) => `code_${index}`);
  expect(detailsOfMembers([member(1, 'failure', codes)]).pullRequests[0]?.failureCodes).toEqual(codes.slice(0, 20));
  const many = Array.from({ length: 25 }, (_, index) => member(index + 1));
  expect(detailsOfMembers(many).pullRequests).toHaveLength(25);
  expect(() => detailsOfMembers([...many, member(26)])).toThrow();
});

test('the details of a group that failed without a verdict on its pull requests name the code and no pull request', () => {
  expect(detailsOfFailure('pull_requests_not_determined')).toEqual({
    version: 1,
    outcome: 'failure',
    code: 'pull_requests_not_determined',
    pullRequests: [],
  });
  expect(detailsOfFailure('evaluation_failed').code).toBe('evaluation_failed');
  expect(mergeGroupDetailsSchema.safeParse(detailsOfFailure('evaluation_failed')).success).toBe(true);
});

test.each([
  ['a key nobody declared', { version: 1, outcome: 'failure', pullRequests: [], login: 'octocat' }],
  ['another version', { version: 2, outcome: 'failure', pullRequests: [] }],
  ['an outcome that is none', { version: 1, outcome: 'neutral', pullRequests: [] }],
  ['a code that is none', { version: 1, outcome: 'failure', code: 'because', pullRequests: [] }],
  [
    'a pull request number of zero',
    { version: 1, outcome: 'success', pullRequests: [{ number: 0, outcome: 'success', failureCodes: [] }] },
  ],
  [
    'a pull request with a key nobody declared',
    { version: 1, outcome: 'success', pullRequests: [{ number: 1, outcome: 'success', failureCodes: [], title: 'x' }] },
  ],
  [
    'a code of 65 characters',
    {
      version: 1,
      outcome: 'failure',
      pullRequests: [{ number: 1, outcome: 'failure', failureCodes: ['x'.repeat(65)] }],
    },
  ],
])('the schema of the details refuses %s', (_name, details) => {
  expect(mergeGroupDetailsSchema.safeParse(details).success).toBe(false);
});
