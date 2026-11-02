// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { extractActors } from './actors.ts';
import { assessCoverage } from './coverage.ts';
import {
  account,
  commitFacts,
  allowlistEntry as entry,
  evaluationInput,
  extractedActor,
  shuffled,
  signatureFact,
} from './test-support.ts';

// E08-S04: the verdict as a whole: no active CLA, the failure codes and fixes of several actors, the opener, and the
// determinism of the result.

const everyone = [extractedActor(30, 'Bot'), extractedActor(20), extractedActor(10, 'Organization'), extractedActor(5)];

test('without an active CLA the outcome is failure with no_active_cla and nothing else', () => {
  const result = assessCoverage(evaluationInput({ policy: null }), everyone);
  expect(result.outcome).toBe('failure');
  expect(result.failureCodes).toEqual(['no_active_cla']);
  expect(result.fixes).toEqual([]);
});

test('without an active CLA every actor is still listed, uncovered, with no basis, whatever the facts say', () => {
  const facts = evaluationInput({
    policy: null,
    signatures: [signatureFact(1, 20), signatureFact(2, 5)],
    allowlist: [entry(1, 'bot', 30), entry(2, 'user', 10)],
  });
  const result = assessCoverage(facts, everyone);
  expect(result.actors.map((actor) => [actor.account.id, actor.covered, actor.basis])).toEqual([
    [30, false, null],
    [20, false, null],
    [10, false, null],
    [5, false, null],
  ]);
});

test('without an active CLA the roles and commits of the actors are kept', () => {
  const actors = [extractedActor(1, 'User', ['opener', 'author'], ['aa', 'bb'])];
  expect(assessCoverage(evaluationInput({ policy: null }), actors).actors).toEqual([
    { account: account(1), roles: ['opener', 'author'], shas: ['aa', 'bb'], covered: false, basis: null },
  ]);
});

test('without an active CLA and without actors the outcome is still failure', () => {
  const result = assessCoverage(evaluationInput({ policy: null }), []);
  expect(result).toEqual({ outcome: 'failure', failureCodes: ['no_active_cla'], actors: [], fixes: [] });
});

test('with an active CLA and nobody to cover the outcome is success', () => {
  expect(assessCoverage(evaluationInput(), [])).toEqual({
    outcome: 'success',
    failureCodes: [],
    actors: [],
    fixes: [],
  });
});

test('several uncovered actors: codes are sorted and unique, fixes are sorted by code then id', () => {
  const result = assessCoverage(evaluationInput(), everyone);
  expect(result.failureCodes).toEqual(['bot_not_allowlisted', 'unsigned_contributor']);
  expect(result.fixes).toEqual([
    { code: 'allowlist_account', githubId: 10 },
    { code: 'allowlist_bot', githubId: 30 },
    { code: 'sign_cla', githubId: 5 },
    { code: 'sign_cla', githubId: 20 },
  ]);
});

test('covered actors add neither a code nor a fix, and the actors keep the order they came in', () => {
  const facts = evaluationInput({ signatures: [signatureFact(1, 20)], allowlist: [entry(1, 'bot', 30)] });
  const result = assessCoverage(facts, everyone);
  expect(result.actors.map((actor) => [actor.account.id, actor.covered])).toEqual([
    [30, true],
    [20, true],
    [10, false],
    [5, false],
  ]);
  expect(result.fixes.map((fix) => fix.githubId)).toEqual([10, 5]);
  expect(result.failureCodes).toEqual(['unsigned_contributor']);
});

test('the opener decides the outcome whatever the commits say', () => {
  const signedAuthors = [commitFacts(2), commitFacts(3)];
  const facts = evaluationInput({
    opener: account(9),
    commits: signedAuthors,
    signatures: [signatureFact(1, 2), signatureFact(2, 3)],
  });
  const unsignedOpener = assessCoverage(facts, extractActors(facts).actors);
  expect(unsignedOpener.outcome).toBe('failure');
  expect(unsignedOpener.fixes).toEqual([{ code: 'sign_cla', githubId: 9 }]);
  const signedOpener = { ...facts, signatures: [...facts.signatures, signatureFact(3, 9)] };
  expect(assessCoverage(signedOpener, extractActors(signedOpener).actors).outcome).toBe('success');
});

test.each([0, 1, 2, 50])('an unsigned opener fails the pull request with %d commits by signed authors', (count) => {
  const commits = Array.from({ length: count }, (_, index) => commitFacts(100 + index));
  const signatures = commits.map((commit, index) => signatureFact(index + 1, commit.author?.id ?? 0));
  const facts = evaluationInput({ opener: account(9), commits, signatures });
  const result = assessCoverage(facts, extractActors(facts).actors);
  expect(result.outcome).toBe('failure');
  expect(result.actors.find((actor) => actor.roles.includes('opener'))).toMatchObject({ covered: false, basis: null });
});

test('a signed opener with no commits is a success, and a signed opener with an unsigned author fails on the author', () => {
  const alone = evaluationInput({ opener: account(9), signatures: [signatureFact(1, 9)] });
  expect(assessCoverage(alone, extractActors(alone).actors).outcome).toBe('success');
  const withAuthor = { ...alone, commits: [commitFacts(2)] };
  const result = assessCoverage(withAuthor, extractActors(withAuthor).actors);
  expect(result.fixes).toEqual([{ code: 'sign_cla', githubId: 2 }]);
});

test('the same facts in any order give the same result (100 seeded shuffles)', () => {
  const signatures = [
    signatureFact(1, 20),
    signatureFact(2, 5, { major: 2 }),
    signatureFact(3, 20),
    signatureFact(4, 7),
  ];
  const allowlist = [entry(1, 'bot', 30), entry(2, 'user', 10, 'installation'), entry(3, 'user', 10)];
  const expected = assessCoverage(evaluationInput({ signatures, allowlist }), everyone);
  for (let seed = 1; seed <= 100; seed += 1) {
    const facts = evaluationInput({ signatures: shuffled(signatures, seed), allowlist: shuffled(allowlist, seed) });
    expect(assessCoverage(facts, everyone)).toEqual(expected);
  }
});

test('the facts and the actors are left exactly as they were', () => {
  const facts = evaluationInput({
    signatures: [signatureFact(2, 20), signatureFact(1, 20)],
    allowlist: [entry(1, 'bot', 30)],
  });
  const before = structuredClone({ facts, everyone });
  assessCoverage(facts, everyone);
  expect(structuredClone({ facts, everyone })).toEqual(before);
});
