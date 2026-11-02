// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseStoredDetails, STORED_LIMITS } from '../../../shared/pr-evaluation-details.ts';
import { evaluatePullRequest } from './evaluate.ts';
import { compareText } from './order.ts';
import { toStoredDetails } from './stored-details.ts';
import {
  account,
  coAuthoredBy,
  commitFacts,
  evaluationInput,
  messageEndingWith,
  sha,
  signatureFact,
} from './test-support.ts';
import type { CommitFacts, EvaluationInput } from './types.ts';

// E08-S08: what the stored value keeps when a list is over its limit. The uncovered actors and the findings without an
// override come first, the rest follow, each group in its own order, and `omitted` counts what was left out. The verdict
// is computed before and never changes.

const FIRST = 100_000_000;
const OPENER_SIGNED = signatureFact(1, 1);
const authors = (count: number, build: (index: number) => Partial<CommitFacts> = () => ({})): CommitFacts[] =>
  Array.from({ length: count }, (_unused, index) =>
    commitFacts(index + 10, { author: account(FIRST + index), committer: account(FIRST + index), ...build(index) }),
  );
const detailsOf = (input: EvaluationInput) => toStoredDetails(evaluatePullRequest(input));

test('exactly 500 actors are all stored and nothing is omitted', () => {
  const input = evaluationInput({ commits: authors(499), signatures: [OPENER_SIGNED] });
  const details = detailsOf(input);
  expect(details.actors).toHaveLength(500);
  expect('omitted' in details).toBe(false);
});

test('501 actors store 500 and count one omitted', () => {
  const input = evaluationInput({ commits: authors(500), signatures: [OPENER_SIGNED] });
  const details = detailsOf(input);
  expect(details.actors).toHaveLength(500);
  expect(details.omitted).toEqual({ actors: 1, unlinked: 0, advisories: 0 });
});

test('the uncovered actors are kept before the covered ones, even with higher ids, and the kept ones stay in order', () => {
  const signed = 600;
  const signatures = [
    OPENER_SIGNED,
    ...Array.from({ length: signed }, (_unused, index) => signatureFact(index + 2, FIRST + index)),
  ];
  const details = detailsOf(evaluationInput({ commits: authors(signed + 100), signatures }));
  const ids = details.actors.map((actor) => actor.githubId);
  expect(details.actors.filter((actor) => !actor.covered).map((actor) => actor.githubId)).toEqual(
    Array.from({ length: 100 }, (_unused, index) => FIRST + signed + index),
  );
  expect(details.actors.filter((actor) => actor.covered)).toHaveLength(400);
  expect(ids).toEqual(ids.toSorted((a, b) => a - b));
  expect(details.omitted?.actors).toBe(701 - 500);
});

test('when the uncovered actors alone are over the limit, the lowest ids of them are kept', () => {
  const details = detailsOf(evaluationInput({ commits: authors(800) }));
  expect(details.actors.every((actor) => !actor.covered)).toBe(true);
  expect(details.actors[0]?.githubId).toBe(1);
  expect(details.actors.at(-1)?.githubId).toBe(FIRST + 498);
  expect(details.omitted?.actors).toBe(801 - 500);
});

test('the findings without an override are kept before the overridden ones, even with higher SHAs', () => {
  const open = 100;
  const commits = Array.from({ length: 600 }, (_unused, index) =>
    commitFacts(index + 10, { author: null, committer: account(FIRST) }),
  );
  const overrides = new Map(commits.slice(0, 600 - open).map((commit, index) => [commit.sha, index + 1]));
  const signatures = [OPENER_SIGNED, signatureFact(2, FIRST)];
  const details = detailsOf(evaluationInput({ commits, overrides, signatures }));
  const shas = details.unlinked.map((finding) => finding.sha);
  expect(details.unlinked).toHaveLength(500);
  expect(details.unlinked.filter((finding) => finding.overrideId === null).map((finding) => finding.sha)).toEqual(
    commits.slice(600 - open).map((commit) => commit.sha),
  );
  expect(shas).toEqual(shas.toSorted(compareText));
  expect(details.omitted).toEqual({ actors: 0, unlinked: 100, advisories: 0 });
});

test('the advisories over the limit are cut in order of SHA and counted', () => {
  const unresolved = messageEndingWith(coAuthoredBy('someone@example.org'));
  const commits = authors(600, () => ({ message: unresolved }));
  const details = detailsOf(evaluationInput({ commits, signatures: [OPENER_SIGNED] }));
  expect(details.advisories).toHaveLength(500);
  expect(details.advisories[0]).toEqual({ code: 'co_author_unresolved', sha: sha(10) });
  expect(details.advisories.at(-1)).toEqual({ code: 'co_author_unresolved', sha: sha(509) });
  expect(details.omitted?.advisories).toBe(100);
});

test('leaving entries out changes neither the outcome nor the failure codes', () => {
  const evaluation = evaluatePullRequest(evaluationInput({ commits: authors(800) }));
  const details = toStoredDetails(evaluation);
  expect(details.outcome).toBe(evaluation.outcome);
  expect(details.failureCodes).toEqual(evaluation.failureCodes);
  expect(details.failureCodes).toEqual(['unsigned_contributor']);
  expect(evaluation.actors).toHaveLength(801);
});

test('a value with entries left out is a valid stored value', () => {
  const details = detailsOf(evaluationInput({ commits: authors(800) }));
  expect(parseStoredDetails(details)).toEqual({ ok: true, details });
  expect(STORED_LIMITS.actors).toBe(details.actors.length);
});
