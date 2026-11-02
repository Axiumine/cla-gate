// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { evaluatePullRequest } from './evaluate.ts';
import { GITHUB_WEB_FLOW_ID } from './github-identities.ts';
import {
  account,
  allowlistEntry,
  coAuthoredBy,
  commitFacts,
  evaluationInput,
  membership,
  messageEndingWith,
  noreplyEmail,
  seededRandom,
  sha,
  signatureFact,
} from './test-support.ts';
import type { Account, AllowlistEntry, CommitFacts, EvaluationInput, SignatureFact } from './types.ts';

// E08-S08: monotonicity, as a seeded loop that needs no property-testing library. Facts only ever help: adding a valid
// signature or a matching allowlist entry never turns a success into a failure, and removing one never turns a failure
// into a success. The generator makes small pull requests out of people 2 to 7, bots 8 and 9, unlinked identities, the
// web-flow committer, merge commits and co-author trailers; the opener is user 1.

const SEEDS = Array.from({ length: 300 }, (_unused, index) => index + 1);

type Next = () => number;

/** An account for an id of the pool: 2 to 7 are people, 8 and 9 are bots. */
const accountOf = (id: number): Account => account(id, id >= 8 ? 'Bot' : 'User');
const poolId = (next: Next): number => 2 + Math.floor(next() * 8);

/** A committer is `web-flow` three times in ten, else somebody of the pool. */
const committerId = (next: Next): number => (next() < 0.3 ? GITHUB_WEB_FLOW_ID : poolId(next));

function randomCommit(index: number, next: Next): CommitFacts {
  const author = next() < 0.15 ? null : accountOf(poolId(next));
  const committer = next() < 0.15 ? null : account(committerId(next));
  return commitFacts(index + 10, {
    author,
    committer,
    parents: next() < 0.1 ? [sha(1), sha(2)] : [sha(index + 9)],
    message: next() < 0.25 ? messageEndingWith(coAuthoredBy(noreplyEmail(poolId(next), 'pair'))) : 'change',
  });
}

function randomSignatures(next: Next): SignatureFact[] {
  return Array.from({ length: 9 }, (_unused, index) => index + 1)
    .filter(() => next() < 0.4)
    .map((githubId) => signatureFact(githubId, githubId));
}

function randomAllowlist(next: Next): AllowlistEntry[] {
  return [
    next() < 0.3 ? allowlistEntry(1, 'user', poolId(next)) : null,
    next() < 0.3 ? allowlistEntry(2, 'bot', 8 + Math.floor(next() * 2), 'installation') : null,
    next() < 0.3 ? allowlistEntry(3, 'org_members', 500) : null,
  ].filter((entry) => entry !== null);
}

/** A random pull request; the memberships and overrides are part of the facts but never the ones that are added or removed. */
function randomPullRequest(seed: number): EvaluationInput {
  const next = seededRandom(seed);
  const commits = Array.from({ length: Math.floor(next() * 4) }, (_unused, index) => randomCommit(index, next));
  return evaluationInput({
    commits,
    signatures: randomSignatures(next),
    allowlist: randomAllowlist(next),
    orgMembers: membership([500, [2, 3, 4, 5].filter(() => next() < 0.5)]),
    overrides: new Map(commits.filter(() => next() < 0.3).map((commit) => [commit.sha, 500])),
  });
}

/**
 * One more fact that helps: a valid signature, or an allowlist entry of some kind, for an id. Most of the time the id is
 * one that is uncovered now, so the fact can really fix the pull request; otherwise it is any id of the pool.
 */
function withOneMoreFact(input: EvaluationInput, seed: number): EvaluationInput {
  const next = seededRandom(seed * 7919);
  const uncovered = evaluatePullRequest(input)
    .actors.filter((actor) => !actor.covered)
    .map((actor) => actor.account.id);
  const id = (next() < 0.8 ? uncovered.at(Math.floor(next() * uncovered.length)) : undefined) ?? poolId(next);
  if (next() < 0.5) {
    return { ...input, signatures: [...input.signatures, signatureFact(1000, id)] };
  }
  const kind = (['user', 'bot', 'org_members'] as const).at(Math.floor(next() * 3)) ?? 'user';
  const githubId = kind === 'org_members' ? 500 : id;
  const scope = next() < 0.5 ? 'installation' : 'repository';
  return { ...input, allowlist: [...input.allowlist, allowlistEntry(2000, kind, githubId, scope)] };
}

const outcomeOf = (input: EvaluationInput) => evaluatePullRequest(input).outcome;

test('adding a valid signature or a matching allowlist entry never turns a success into a failure', () => {
  let flips = 0;
  let successes = 0;
  for (const seed of SEEDS) {
    const base = randomPullRequest(seed);
    const before = outcomeOf(base);
    const after = outcomeOf(withOneMoreFact(base, seed));
    expect([before, after]).not.toEqual(['success', 'failure']);
    successes += before === 'success' ? 1 : 0;
    flips += before === 'failure' && after === 'success' ? 1 : 0;
  }
  // The loop is not vacuous: it starts from passing pull requests, and a fact can fix a failing one.
  expect(successes).toBeGreaterThan(10);
  expect(flips).toBeGreaterThan(10);
});

test('removing a signature or an allowlist entry never turns a failure into a success', () => {
  let failures = 0;
  let removals = 0;
  for (const seed of SEEDS) {
    const input = withOneMoreFact(withOneMoreFact(randomPullRequest(seed), seed), seed + 5000);
    if (outcomeOf(input) === 'failure') {
      failures += 1;
      const withoutOne: EvaluationInput[] = [
        ...input.signatures.map((_fact, index) => ({ ...input, signatures: input.signatures.toSpliced(index, 1) })),
        ...input.allowlist.map((_entry, index) => ({ ...input, allowlist: input.allowlist.toSpliced(index, 1) })),
      ];
      for (const fewer of withoutOne) {
        removals += 1;
        expect(outcomeOf(fewer)).toBe('failure');
      }
    }
  }
  expect(failures).toBeGreaterThan(10);
  expect(removals).toBeGreaterThan(50);
});
