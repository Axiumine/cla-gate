// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { failureDetails, successDetails } from './failure-details-fixture/test-support.ts';
import {
  FAILING_LOOKUP_ROWS,
  listsUncovered,
  MAX_FAILING_PULL_REQUESTS,
  signatureEvaluationKey,
  uncoveredActorNeedle,
} from './signature-evaluations.ts';

// The pure rules of the evaluations a signature asks for (E13-S07): the cap, the key of a send and the one question asked of a
// stored failure.

const ADA = parseGithubId(1234);

test('at most 25 other pull requests are sent, from at most four times as many stored failures', () => {
  expect([MAX_FAILING_PULL_REQUESTS, FAILING_LOOKUP_ROWS]).toEqual([25, 100]);
});

test('the key of a send names the signature, the repository and the pull request, so no two sends of one signing share it', () => {
  const keys = [
    signatureEvaluationKey(31, parseGithubId(9000), 45),
    signatureEvaluationKey(31, parseGithubId(9000), 46),
    signatureEvaluationKey(31, parseGithubId(9001), 45),
    signatureEvaluationKey(32, parseGithubId(9000), 45),
  ];
  expect(keys).toEqual([
    'signature:31:9000:45',
    'signature:31:9000:46',
    'signature:31:9001:45',
    'signature:32:9000:45',
  ]);
  expect(new Set(keys).size).toBe(keys.length);
});

test('the needle of the statement is the document that a failure listing the person as uncovered contains', () => {
  expect(JSON.parse(uncoveredActorNeedle(ADA))).toEqual({ actors: [{ githubId: 1234, covered: false }] });
});

test.each([
  ['an uncovered actor of that id', failureDetails({ uncovered: [ADA] }), true],
  ['an uncovered actor among others', failureDetails({ uncovered: [7, ADA, 9], covered: [3] }), true],
  ['another uncovered actor only', failureDetails({ uncovered: [7] }), false],
  ['the id covered, not uncovered', failureDetails({ uncovered: [7], covered: [ADA] }), false],
  ['a pull request that passed, with the id covered', successDetails([ADA]), false],
  ['no actors at all', failureDetails({ uncovered: [] }), false],
] as const)('a stored value with %s answers %s', (_name, details, listed) => {
  expect(listsUncovered(details, ADA)).toBe(listed);
});

test.each([
  ['an evaluation still in progress (empty details)', {}],
  ['a value of another version', { ...failureDetails({ uncovered: [ADA] }), version: 2 }],
  ['an unknown key', { ...failureDetails({ uncovered: [ADA] }), login: 'ada' }],
  ['a login in place of the id', { ...failureDetails({ uncovered: [] }), actors: [{ login: 'ada', covered: false }] }],
  ['a string', 'actors'],
  ['null', null],
])('%s lists nobody, because the schema of E08 refuses it', (_name, details) => {
  expect(listsUncovered(details, ADA)).toBe(false);
});

test('the id is the numeric GitHub id: the same digits as another actor do not match a different id', () => {
  expect(listsUncovered(failureDetails({ uncovered: [12_345] }), parseGithubId(1234))).toBe(false);
  expect(listsUncovered(failureDetails({ uncovered: [1234] }), parseGithubId(12_345))).toBe(false);
});
