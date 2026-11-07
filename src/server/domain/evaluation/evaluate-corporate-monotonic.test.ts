// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { evaluatePullRequest } from './evaluate.ts';
import { account, commitFacts, corporateCover, evaluationInput, seededRandom, sha } from './test-support.ts';
import type { CorporateCover, EvaluationInput } from './types.ts';

// E21-S05: monotonicity of the corporate approval, as a seeded loop that needs no property-testing library. Adding an approval for a person
// never turns a covered author into an uncovered one, and removing one never covers an author who was not covered. The pull request is
// opened by user 1 and written by people 2 to 7 (some of them committed by others); the people of the pool who are not approved are uncovered.

const SEEDS = Array.from({ length: 300 }, (_unused, index) => index + 1);
const COVER: CorporateCover = { agreementId: 100, approvalId: 1 };

type Next = () => number;

const poolId = (next: Next): number => 1 + Math.floor(next() * 7);

/** A pull request of up to four commits by and for the people of the pool, with a random part of them approved. */
function randomPullRequest(seed: number): EvaluationInput {
  const next = seededRandom(seed);
  const commits = Array.from({ length: 1 + Math.floor(next() * 4) }, (_unused, index) =>
    commitFacts(index + 10, {
      author: account(poolId(next)),
      committer: account(poolId(next)),
      parents: [sha(index + 9)],
    }),
  );
  const approved = [1, 2, 3, 4, 5, 6, 7].filter(() => next() < 0.6);
  return evaluationInput({
    commits,
    corporateCovered: corporateCover(...approved.map((id) => [id, 100, id] as const)),
  });
}

/** The ids covered, by what the engine says. */
const coveredIds = (input: EvaluationInput): number[] =>
  evaluatePullRequest(input)
    .actors.filter((actor) => actor.covered)
    .map((actor) => actor.account.id);

const withApproval = (input: EvaluationInput, id: number): EvaluationInput => ({
  ...input,
  corporateCovered: new Map([...input.corporateCovered, [id, COVER]]),
});

const withoutApproval = (input: EvaluationInput, id: number): EvaluationInput => ({
  ...input,
  corporateCovered: new Map([...input.corporateCovered].filter(([approved]) => approved !== id)),
});

test('adding an approval never turns a covered author uncovered, nor a passing pull request into a failing one', () => {
  let fixed = 0;
  let passing = 0;
  for (const seed of SEEDS) {
    const base = randomPullRequest(seed);
    const before = coveredIds(base);
    for (let id = 1; id <= 7; id += 1) {
      const more = withApproval(base, id);
      const after = coveredIds(more);
      expect(before.filter((covered) => !after.includes(covered))).toEqual([]);
      expect(evaluatePullRequest(base).outcome === 'success' && evaluatePullRequest(more).outcome === 'failure').toBe(
        false,
      );
      fixed += after.length - before.length;
    }
    passing += evaluatePullRequest(base).outcome === 'success' ? 1 : 0;
  }
  // The loop is not vacuous: it starts from passing pull requests, and an approval can cover someone who was not.
  expect(passing).toBeGreaterThan(10);
  expect(fixed).toBeGreaterThan(50);
});

test('removing an approval never covers an author who was not covered, nor turns a failing pull request into a passing one', () => {
  let uncovered = 0;
  let failing = 0;
  for (const seed of SEEDS) {
    const base = randomPullRequest(seed);
    const before = coveredIds(base);
    for (const id of base.corporateCovered.keys()) {
      const fewer = withoutApproval(base, id);
      const after = coveredIds(fewer);
      expect(after.filter((covered) => !before.includes(covered))).toEqual([]);
      expect(evaluatePullRequest(base).outcome === 'failure' && evaluatePullRequest(fewer).outcome === 'success').toBe(
        false,
      );
      uncovered += before.length - after.length;
    }
    failing += evaluatePullRequest(base).outcome === 'failure' ? 1 : 0;
  }
  expect(failing).toBeGreaterThan(10);
  expect(uncovered).toBeGreaterThan(50);
});
