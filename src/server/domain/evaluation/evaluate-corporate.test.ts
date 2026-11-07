// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { PrEvaluationDetails } from '../../../shared/pr-evaluation-details.ts';
import { evaluatePullRequest } from './evaluate.ts';
import { toStoredDetails } from './stored-details.ts';
import { account, commitFacts, corporateCover, evaluationInput } from './test-support.ts';
import type { EvaluationInput } from './types.ts';

// E21-S05: a valid corporate approval is one more way to cover an author, and nothing else changes. The opener (user 1) and every non-exempt
// author and committer still each need a basis, so one approved person never covers another.

/** A pull request opened by user 1 with one commit by user 2, committed by user 3. */
const pr = (overrides: Partial<EvaluationInput>): EvaluationInput =>
  evaluationInput({
    commits: [commitFacts(2, { author: account(2), committer: account(3) })],
    ...overrides,
  });

const everyone = corporateCover([1, 100, 11], [2, 100, 12], [3, 100, 13]);

test('every person of a pull request covered by an approval passes, and each basis names its agreement and approval', () => {
  const evaluation = evaluatePullRequest(pr({ corporateCovered: everyone }));
  expect(evaluation.outcome).toBe('success');
  expect(evaluation.failureCodes).toEqual([]);
  expect(evaluation.actors.map((actor) => [actor.account.id, actor.basis])).toEqual([
    [1, { kind: 'corporate_approval', agreementId: 100, approvalId: 11 }],
    [2, { kind: 'corporate_approval', agreementId: 100, approvalId: 12 }],
    [3, { kind: 'corporate_approval', agreementId: 100, approvalId: 13 }],
  ]);
});

test('the opener covered by an approval is not enough: a committer who is unsigned still fails the pull request', () => {
  const evaluation = evaluatePullRequest(pr({ corporateCovered: corporateCover([1, 100, 11], [2, 100, 12]) }));
  expect(evaluation.outcome).toBe('failure');
  expect(evaluation.failureCodes).toEqual(['unsigned_contributor']);
  expect(evaluation.actors.filter((actor) => !actor.covered).map((actor) => actor.account.id)).toEqual([3]);
  expect(evaluation.fixes).toEqual([{ code: 'sign_cla', githubId: 3 }]);
});

test('an author covered by an approval does not cover an opener who is not', () => {
  const evaluation = evaluatePullRequest(pr({ corporateCovered: corporateCover([2, 100, 12], [3, 100, 13]) }));
  expect(evaluation.outcome).toBe('failure');
  expect(evaluation.actors.filter((actor) => !actor.covered).map((actor) => [actor.account.id, actor.roles])).toEqual([
    [1, ['opener']],
  ]);
});

test('an approval of an outdated agreement covers nobody: the pull request fails and the person carries the mark', () => {
  const evaluation = evaluatePullRequest(
    pr({ corporateCovered: corporateCover([2, 100, 12], [3, 100, 13]), corporateOutdated: new Set([1]) }),
  );
  expect(evaluation.outcome).toBe('failure');
  expect(evaluation.actors.find((actor) => actor.account.id === 1)).toMatchObject({
    covered: false,
    corporateOutdated: true,
  });
});

test('the stored details record per person the basis, the agreement and the approval, and parse as the schema of E08-S01', () => {
  const details = toStoredDetails(evaluatePullRequest(pr({ corporateCovered: everyone })));
  expect(details.actors.map((actor) => actor.basis)).toEqual([
    { kind: 'corporate_approval', agreementId: 100, approvalId: 11 },
    { kind: 'corporate_approval', agreementId: 100, approvalId: 12 },
    { kind: 'corporate_approval', agreementId: 100, approvalId: 13 },
  ]);
  expect(PrEvaluationDetails.parse(details)).toEqual(details);
});

test('the outdated mark is for the report and never reaches the stored details', () => {
  const details = toStoredDetails(evaluatePullRequest(pr({ corporateOutdated: new Set([1, 2, 3]) })));
  expect(JSON.stringify(details)).not.toContain('orporate');
  expect(details.actors.every((actor) => !('corporateOutdated' in actor))).toBe(true);
});

test('a value stored before the corporate basis existed still parses, and so does a mix of the three bases', () => {
  const before = toStoredDetails(evaluatePullRequest(evaluationInput({ signatures: [] })));
  expect(PrEvaluationDetails.parse(before)).toEqual(before);
  const mixed = PrEvaluationDetails.parse({
    ...before,
    outcome: 'success',
    failureCodes: [],
    actors: [
      {
        githubId: 1,
        roles: ['opener'],
        covered: true,
        basis: { kind: 'signature', signatureId: 1, versionId: 2, major: 1 },
      },
      {
        githubId: 2,
        roles: ['author'],
        covered: true,
        basis: { kind: 'allowlist', entryId: 3, entryKind: 'user', scope: 'repository' },
      },
      {
        githubId: 3,
        roles: ['committer'],
        covered: true,
        basis: { kind: 'corporate_approval', agreementId: 4, approvalId: 5 },
      },
    ],
  });
  expect(mixed.actors.map((actor) => actor.basis?.kind)).toEqual(['signature', 'allowlist', 'corporate_approval']);
});
