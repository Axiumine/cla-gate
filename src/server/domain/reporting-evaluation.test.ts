// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { evaluatePullRequest } from './evaluation/index.ts';
import {
  account,
  allowlistEntry,
  commitFacts,
  evaluationInput,
  sha,
  signatureFact,
} from './evaluation/test-support.ts';
import { coverageCounts } from './reporting/coverage-counts.ts';

// E09-S02: the counts of the success summary, taken from the verdicts of the real engine (E08), not from hand-made data. The
// counter describes an evaluation by the two fields it reads, and passing the engine's own value type-checks that they exist.

test('each actor is counted once, under the basis that covers it', () => {
  const evaluation = evaluatePullRequest(
    evaluationInput({
      opener: account(1),
      commits: [
        commitFacts(2, { author: account(2), committer: account(2) }),
        commitFacts(3, { author: account(3), committer: account(3) }),
      ],
      signatures: [signatureFact(1, 1), signatureFact(2, 2)],
      allowlist: [allowlistEntry(1, 'user', 3)],
    }),
  );
  expect(evaluation.outcome).toBe('success');
  expect(coverageCounts(evaluation)).toEqual({ signature: 2, allowlist: 1, override: 0 });
});

test('an actor with a signature and an allowlist entry is counted once, under the signature that wins', () => {
  const evaluation = evaluatePullRequest(
    evaluationInput({ signatures: [signatureFact(1, 1)], allowlist: [allowlistEntry(1, 'user', 1)] }),
  );
  expect(coverageCounts(evaluation)).toEqual({ signature: 1, allowlist: 0, override: 0 });
});

test('a commit whose author and committer are both unlinked and overridden counts as one override', () => {
  const evaluation = evaluatePullRequest(
    evaluationInput({
      signatures: [signatureFact(1, 1)],
      commits: [commitFacts(5, { author: null, committer: null })],
      overrides: new Map([[sha(5), 77]]),
    }),
  );
  expect(evaluation.outcome).toBe('success');
  expect(coverageCounts(evaluation)).toEqual({ signature: 1, allowlist: 0, override: 1 });
});

test('an unlinked commit without an override is not counted as covered', () => {
  const evaluation = evaluatePullRequest(
    evaluationInput({ signatures: [signatureFact(1, 1)], commits: [commitFacts(5, { author: null })] }),
  );
  expect(evaluation.outcome).toBe('failure');
  expect(coverageCounts(evaluation).override).toBe(0);
});

test('an actor that is not covered counts under no basis', () => {
  const evaluation = evaluatePullRequest(evaluationInput());
  expect(evaluation.outcome).toBe('failure');
  expect(coverageCounts(evaluation)).toEqual({ signature: 0, allowlist: 0, override: 0 });
});
