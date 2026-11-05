// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { assessCoverage } from './coverage.ts';
import {
  corporateCover,
  allowlistEntry as entry,
  evaluationInput,
  extractedActor,
  signatureFact,
} from './test-support.ts';
import type { AccountType, CoveringBasis, EvaluationInput } from './types.ts';

// E21-S05: coverage of one account (id 10) by an approval of a corporate agreement, and the order of the three bases: a signature, then an
// allowlist entry (E08-S04), then the approval. The approval is the basis of last resort, so it never hides another basis, and only a person
// can hold one.

const approved = (agreementId: number, approvalId: number): CoveringBasis => ({
  kind: 'corporate_approval',
  agreementId,
  approvalId,
});

/** The basis of account 10 of the type, or `null`, under the facts, through the coverage rules alone. */
function basisOf(facts: Partial<EvaluationInput>, type: AccountType = 'User') {
  const input = evaluationInput(facts);
  return assessCoverage(input, [extractedActor(10, type, ['opener'])]).actors[0];
}

test('an approval covers a person with no other basis, and names the agreement and the approval by id', () => {
  const actor = basisOf({ corporateCovered: corporateCover([10, 4, 7]) });
  expect(actor?.covered).toBe(true);
  expect(actor?.basis).toEqual(approved(4, 7));
});

test('a signature wins over an approval for the same person', () => {
  expect(basisOf({ signatures: [signatureFact(1, 10)], corporateCovered: corporateCover([10, 4, 7]) })?.basis).toEqual({
    kind: 'signature',
    signatureId: 1,
    versionId: 1001,
    major: 1,
  });
});

test('an allowlist entry wins over an approval for the same person', () => {
  expect(basisOf({ allowlist: [entry(3, 'user', 10)], corporateCovered: corporateCover([10, 4, 7]) })?.basis).toEqual({
    kind: 'allowlist',
    entryId: 3,
    entryKind: 'user',
    scope: 'repository',
  });
});

test('a revoked signature and an unknown organisation fall through to the approval', () => {
  const facts = {
    signatures: [signatureFact(1, 10, { revoked: true })],
    allowlist: [entry(5, 'org_members', 500)],
    corporateCovered: corporateCover([10, 4, 7]),
  };
  expect(basisOf(facts)?.basis).toEqual(approved(4, 7));
});

test('an approval of someone else covers nobody here', () => {
  const actor = basisOf({ corporateCovered: corporateCover([11, 4, 7]) });
  expect(actor?.covered).toBe(false);
  expect(actor?.basis).toBeNull();
});

test.each<AccountType>(['Bot', 'Organization', 'Mannequin'])(
  'a %s cannot hold an approval: an approval for its id covers nothing',
  (type) => {
    expect(basisOf({ corporateCovered: corporateCover([10, 4, 7]) }, type)?.basis).toBeNull();
  },
);

test('an Unknown co-author, who may be a person, is covered by an approval', () => {
  expect(basisOf({ corporateCovered: corporateCover([10, 4, 7]) }, 'Unknown')?.basis).toEqual(approved(4, 7));
});

test('an uncovered person who holds an approval under an outdated agreement carries the mark, and still fails as unsigned', () => {
  const input = evaluationInput({ corporateOutdated: new Set([10]) });
  const result = assessCoverage(input, [extractedActor(10, 'User', ['opener'])]);
  expect(result.actors[0]).toMatchObject({ covered: false, basis: null, corporateOutdated: true });
  expect(result.failureCodes).toEqual(['unsigned_contributor']);
  expect(result.fixes).toEqual([{ code: 'sign_cla', githubId: 10 }]);
});

test('the mark is only for a person who is not covered, and only for a person', () => {
  expect(basisOf({ corporateOutdated: new Set([10]), signatures: [signatureFact(1, 10)] })).not.toHaveProperty(
    'corporateOutdated',
  );
  expect(
    basisOf({ corporateOutdated: new Set([10]), corporateCovered: corporateCover([10, 4, 7]) }),
  ).not.toHaveProperty('corporateOutdated');
  expect(basisOf({ corporateOutdated: new Set([10]) }, 'Bot')).not.toHaveProperty('corporateOutdated');
  expect(basisOf({ corporateOutdated: new Set([11]) })).not.toHaveProperty('corporateOutdated');
});

test('without an active CLA nothing is covered by an approval and nothing is marked', () => {
  const input = evaluationInput({
    policy: null,
    corporateCovered: corporateCover([10, 4, 7]),
    corporateOutdated: new Set([10]),
  });
  const result = assessCoverage(input, [extractedActor(10, 'User', ['opener'])]);
  expect(result.failureCodes).toEqual(['no_active_cla']);
  expect(result.actors[0]).toEqual({ ...extractedActor(10, 'User', ['opener']), covered: false, basis: null });
});
