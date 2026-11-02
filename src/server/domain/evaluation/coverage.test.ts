// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { assessCoverage } from './coverage.ts';
import type { ActorFix } from './coverage-types.ts';
import { allowlistEntry as entry, evaluationInput, extractedActor, membership, signatureFact } from './test-support.ts';
import type { CoveringBasis, EvaluationInput, FailureCode } from './types.ts';

// E08-S04: coverage of one person (id 10, a User) by signature and by allowlist. Each row names the facts, and says by
// what the person is covered (a basis, or null) and, if not, which failure code and fix result. The default policy is
// document 1 at major 1 unless a row replaces it.

interface Row {
  readonly name: string;
  readonly facts: Partial<EvaluationInput>;
  readonly basis: CoveringBasis | null;
}

const signed = (id: number, major = 1): CoveringBasis => ({
  kind: 'signature',
  signatureId: id,
  versionId: 1000 + id,
  major,
});
const listed = (
  entryId: number,
  entryKind: 'user' | 'bot' | 'org_members',
  scope: 'installation' | 'repository' = 'repository',
): CoveringBasis => ({
  kind: 'allowlist',
  entryId,
  entryKind,
  scope,
});

const rows: readonly Row[] = [
  { name: 'a signature at the active major covers', facts: { signatures: [signatureFact(1, 10)] }, basis: signed(1) },
  {
    name: 'a lower major is uncovered',
    facts: { policy: { documentId: 1, activeMajor: 2 }, signatures: [signatureFact(1, 10, { major: 1 })] },
    basis: null,
  },
  {
    name: 'a higher major is uncovered',
    facts: { policy: { documentId: 1, activeMajor: 2 }, signatures: [signatureFact(1, 10, { major: 3 })] },
    basis: null,
  },
  {
    name: 'another document is ignored',
    facts: { signatures: [signatureFact(1, 10, { documentId: 2 })] },
    basis: null,
  },
  {
    name: 'a revoked signature is ignored',
    facts: { signatures: [signatureFact(1, 10, { revoked: true })] },
    basis: null,
  },
  {
    name: 'two matching facts: the lowest signature id is the basis',
    facts: { signatures: [signatureFact(7, 10), signatureFact(4, 10)] },
    basis: signed(4),
  },
  {
    name: 'signed and allowlisted: the signature is the basis',
    facts: { signatures: [signatureFact(1, 10)], allowlist: [entry(1, 'user', 10)] },
    basis: signed(1),
  },
  { name: 'allowlisted by a user entry', facts: { allowlist: [entry(3, 'user', 10)] }, basis: listed(3, 'user') },
  {
    name: 'allowlisted by the installation scope keeps its scope in the basis',
    facts: { allowlist: [entry(3, 'user', 10, 'installation')] },
    basis: listed(3, 'user', 'installation'),
  },
  {
    name: 'a revoked signature falls through to the allowlist',
    facts: { signatures: [signatureFact(1, 10, { revoked: true })], allowlist: [entry(3, 'user', 10)] },
    basis: listed(3, 'user'),
  },
  {
    name: 'a signature of the old major falls through to an org_members entry',
    facts: {
      policy: { documentId: 1, activeMajor: 2 },
      signatures: [signatureFact(1, 10, { major: 1 })],
      allowlist: [entry(5, 'org_members', 500)],
      orgMembers: membership([500, [10]]),
    },
    basis: listed(5, 'org_members'),
  },
  {
    name: 'a member of an org whose membership is unknown is uncovered',
    facts: { allowlist: [entry(5, 'org_members', 500)], orgMembers: new Map() },
    basis: null,
  },
  {
    name: 'a bot entry for the person is not a match',
    facts: { allowlist: [entry(2, 'bot', 10)] },
    basis: null,
  },
  {
    name: 'a signature of someone else covers nobody here',
    facts: { signatures: [signatureFact(1, 11)] },
    basis: null,
  },
  {
    name: 'a policy that is not the default (document 7, major 3) is honoured',
    facts: {
      policy: { documentId: 7, activeMajor: 3 },
      signatures: [signatureFact(1, 10, { documentId: 7, major: 3 })],
    },
    basis: signed(1, 3),
  },
];

const UNSIGNED_FIX: ActorFix = { code: 'sign_cla', githubId: 10 };

test.each(rows)('$name', ({ facts, basis }) => {
  const result = assessCoverage(evaluationInput(facts), [extractedActor(10)]);
  const failureCodes: FailureCode[] = basis === null ? ['unsigned_contributor'] : [];
  expect(result.actors).toEqual([
    { account: { id: 10, type: 'User' }, roles: ['author'], shas: [], covered: basis !== null, basis },
  ]);
  expect(result.failureCodes).toEqual(failureCodes);
  expect(result.fixes).toEqual(basis === null ? [UNSIGNED_FIX] : []);
  expect(result.outcome).toBe(basis === null ? 'failure' : 'success');
});
