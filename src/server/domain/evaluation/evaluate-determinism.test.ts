// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { evaluatePullRequest } from './evaluate.ts';
import { compareEvaluationFixes } from './fixes.ts';
import { compareAdvisories, compareShaThenRole, compareText } from './order.ts';
import { fiftyCommitInput, shuffled } from './test-support.ts';
import type { EvaluationInput } from './types.ts';

// E08-S08: the same facts give the same answer, whatever order they arrive in. The fixture is a pull request of 50
// commits (and one listed twice) with every kind of identity in it; each seed puts the commits, the signatures, the
// allowlist entries, the memberships and the overrides in another order.

const input = fiftyCommitInput();
const expected = evaluatePullRequest(input);

function reordered(seed: number): EvaluationInput {
  const members = [...input.orgMembers].map(([orgId, userIds]): [number, Set<number>] => [
    orgId,
    new Set(shuffled([...userIds], seed)),
  ]);
  return {
    ...input,
    commits: shuffled(input.commits, seed),
    signatures: shuffled(input.signatures, seed + 1000),
    allowlist: shuffled(input.allowlist, seed + 2000),
    orgMembers: new Map(shuffled(members, seed + 3000)),
    overrides: new Map(shuffled([...input.overrides], seed + 4000)),
  };
}

const seeds = Array.from({ length: 100 }, (_unused, index) => index + 1);

test.each(seeds)('shuffling the facts (seed %i) does not change the result', (seed) => {
  expect(evaluatePullRequest(reordered(seed))).toEqual(expected);
});

test('the fixture is a real test: it fails with three codes and exercises every kind of fact', () => {
  expect(expected.failureCodes).toEqual(['bot_not_allowlisted', 'unlinked_identity', 'unsigned_contributor']);
  expect(expected.commitCount).toBe(50);
  expect(expected.mergeCommitsSkipped).toBe(2);
  expect(expected.actors.map((actor) => actor.basis?.kind ?? null)).toEqual(
    expect.arrayContaining(['signature', 'allowlist', null]),
  );
  expect(expected.findings.some((finding) => finding.overrideId !== null)).toBe(true);
  expect(expected.findings.some((finding) => finding.overrideId === null)).toBe(true);
  expect(expected.advisories.length).toBeGreaterThan(0);
});

test('evaluating the same input twice gives equal results', () => {
  expect(evaluatePullRequest(input)).toEqual(evaluatePullRequest(input));
});

test('failure codes are sorted and unique', () => {
  expect(expected.failureCodes).toEqual([...new Set(expected.failureCodes)].sort(compareText));
});

test('actors are sorted by numeric id, each with its roles and commits sorted', () => {
  const ids = expected.actors.map((actor) => actor.account.id);
  expect(ids).toEqual([...ids].sort((a, b) => a - b));
  expect(new Set(ids).size).toBe(ids.length);
  for (const actor of expected.actors) {
    expect(actor.shas).toEqual([...actor.shas].sort(compareText));
  }
});

test('findings are sorted by SHA then role, advisories by SHA then code, fixes by code then id or SHA', () => {
  expect(expected.findings).toEqual([...expected.findings].sort(compareShaThenRole));
  expect(expected.advisories).toEqual([...expected.advisories].sort(compareAdvisories));
  expect(expected.fixes).toEqual([...expected.fixes].sort(compareEvaluationFixes));
});
