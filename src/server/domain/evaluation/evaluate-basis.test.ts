// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { evaluatePullRequest } from './evaluate.ts';
import { MAX_EVALUATED_COMMITS, MAX_PULL_COMMITS, planCommitListing } from './listing-plan.ts';
import { listingStateOf } from './listing-state.ts';
import {
  account,
  commitFacts,
  allowlistEntry as entry,
  evaluationInput,
  membership,
  signatureFact,
} from './test-support.ts';
import type { AllowlistEntry, CoveringBasis, EvaluationInput, SignatureFact } from './types.ts';

// E08-S08, mutation readiness: the covering basis a rule chooses, and the commit-count boundaries. User 2 writes the commit and
// is the actor under test; the opener (user 1) has signed.

interface BasisRow {
  readonly name: string;
  readonly signatures?: readonly SignatureFact[];
  readonly allowlist?: readonly AllowlistEntry[];
  readonly basis: CoveringBasis | null;
}

const signature = (id: number, versionId: number): CoveringBasis => ({
  kind: 'signature',
  signatureId: id,
  versionId,
  major: 1,
});

const rows: readonly BasisRow[] = [
  {
    name: 'a signature wins over an allowlist entry for the same person',
    signatures: [signatureFact(5, 2)],
    allowlist: [entry(1, 'user', 2)],
    basis: signature(5, 1005),
  },
  {
    name: 'of two matching signatures the lowest id is the basis, whatever the order',
    signatures: [signatureFact(9, 2), signatureFact(4, 2), signatureFact(6, 2)],
    basis: signature(4, 1004),
  },
  {
    name: 'a revoked signature falls through to the allowlist entry',
    signatures: [signatureFact(5, 2, { revoked: true })],
    allowlist: [entry(1, 'user', 2, 'installation')],
    basis: { kind: 'allowlist', entryId: 1, entryKind: 'user', scope: 'installation' },
  },
  {
    name: 'the repository scope is preferred to the installation scope',
    allowlist: [entry(1, 'user', 2, 'installation'), entry(2, 'user', 2, 'repository')],
    basis: { kind: 'allowlist', entryId: 2, entryKind: 'user', scope: 'repository' },
  },
  {
    name: 'a user entry is preferred to an organisation entry of the same scope',
    allowlist: [entry(1, 'org_members', 700), entry(2, 'user', 2)],
    basis: { kind: 'allowlist', entryId: 2, entryKind: 'user', scope: 'repository' },
  },
  {
    name: 'of two entries of the same scope and kind the lowest id is the basis',
    allowlist: [entry(8, 'user', 2), entry(3, 'user', 2)],
    basis: { kind: 'allowlist', entryId: 3, entryKind: 'user', scope: 'repository' },
  },
  { name: 'nothing covers an unsigned person without an entry', basis: null },
];

test.each(rows)('basis: $name', ({ signatures = [], allowlist = [], basis }) => {
  const evaluation = evaluatePullRequest(
    evaluationInput({
      commits: [commitFacts(2)],
      signatures: [signatureFact(1, 1), ...signatures],
      allowlist,
      orgMembers: membership([700, [2]]),
    }),
  );
  expect(evaluation.actors.find((actor) => actor.account.id === 2)?.basis).toEqual(basis);
});

// The listing: the I/O loop (E07-S04) plans from the count GitHub reports and gives the engine `exceeded` only when a
// limit was hit. 250 is the last count GitHub's own endpoint serves, 2,000 the last the engine evaluates.

function evaluateWithCount(count: number): { strategy: string; input: EvaluationInput } {
  const plan = planCommitListing(count);
  return {
    strategy: plan.strategy,
    input: evaluationInput({ listing: listingStateOf(plan) ?? 'complete', signatures: [signatureFact(1, 1)] }),
  };
}

test.each([
  [0, 'pull_commits', 'success'],
  [MAX_PULL_COMMITS, 'pull_commits', 'success'],
  [MAX_PULL_COMMITS + 1, 'repo_walk', 'success'],
  [MAX_EVALUATED_COMMITS, 'repo_walk', 'success'],
  [MAX_EVALUATED_COMMITS + 1, 'refuse', 'failure'],
])('a pull request of %i commits is listed by %s and the engine says %s', (count, strategy, outcome) => {
  const planned = evaluateWithCount(count);
  expect(planned.strategy).toBe(strategy);
  expect(evaluatePullRequest(planned.input).outcome).toBe(outcome);
});

test('the limits are the numbers the story names', () => {
  expect([MAX_PULL_COMMITS, MAX_EVALUATED_COMMITS]).toEqual([250, 2000]);
});

test('2,000 commits evaluate as one pull request, and the same commits marked exceeded fail', () => {
  const commits = Array.from({ length: 2000 }, (_unused, index) =>
    commitFacts(index + 10, { author: account(2), committer: account(2) }),
  );
  const signatures = [signatureFact(1, 1), signatureFact(2, 2)];
  expect(evaluatePullRequest(evaluationInput({ commits, signatures }))).toMatchObject({
    outcome: 'success',
    commitCount: 2000,
  });
  expect(evaluatePullRequest(evaluationInput({ commits, signatures, listing: 'exceeded' }))).toMatchObject({
    outcome: 'failure',
    failureCodes: ['commit_limit_exceeded'],
  });
});
