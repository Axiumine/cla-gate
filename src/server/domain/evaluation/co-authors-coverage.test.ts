// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { extractActors } from './actors.ts';
import { addCoAuthors } from './co-authors.ts';
import { assessCoverage } from './coverage.ts';
import {
  allowlistEntry,
  coAuthoredBy,
  commitFacts,
  evaluationInput,
  membership,
  messageEndingWith,
  noreplyEmail,
  signatureFact,
} from './test-support.ts';
import type { CommitFacts, EvaluationInput } from './types.ts';

// E08-S06 from trailers to verdict: extraction (S02), co-authors (S06) and coverage (S03, S04) on the same input, the
// way the composition (E08-S08) will run them. The opener (user 1) and the author (user 2) have signed unless a row
// says otherwise, and the co-author is user 40. A co-author is covered by the same rules as anyone else.

const CO_AUTHOR = 40;
const trailer = coAuthoredBy(noreplyEmail(CO_AUTHOR, 'carol'), 'Carol');
const commit = (...lines: readonly string[]): CommitFacts => commitFacts(2, { message: messageEndingWith(...lines) });

function verdict(overrides: Partial<EvaluationInput>, commits: readonly CommitFacts[] = [commit(trailer)]) {
  const input = evaluationInput({ commits, signatures: [signatureFact(1, 1), signatureFact(2, 2)], ...overrides });
  const extraction = addCoAuthors(extractActors(input), input.commits);
  const result = assessCoverage(input, extraction.actors);
  return { result, advisories: extraction.advisories };
}

const basisOf = (result: ReturnType<typeof assessCoverage>, id: number) =>
  result.actors.find((actor) => actor.account.id === id);

test('an unsigned co-author fails the pull request with unsigned_contributor and the fix sign_cla', () => {
  const { result } = verdict({});
  expect(result.outcome).toBe('failure');
  expect(result.failureCodes).toEqual(['unsigned_contributor']);
  expect(result.fixes).toEqual([{ code: 'sign_cla', githubId: CO_AUTHOR }]);
  expect(basisOf(result, CO_AUTHOR)).toMatchObject({ covered: false, basis: null, roles: ['co_author'] });
});

test('a co-author who signed the active version is covered by that signature', () => {
  const { result } = verdict({ signatures: [signatureFact(1, 1), signatureFact(2, 2), signatureFact(3, CO_AUTHOR)] });
  expect(result.outcome).toBe('success');
  expect(basisOf(result, CO_AUTHOR)?.basis).toEqual({ kind: 'signature', signatureId: 3, versionId: 1003, major: 1 });
});

test('a co-author whose signature is for an older major is not covered', () => {
  const { result } = verdict({
    policy: { documentId: 1, activeMajor: 2 },
    signatures: [signatureFact(1, 1, { major: 2 }), signatureFact(2, 2, { major: 2 }), signatureFact(3, CO_AUTHOR)],
  });
  expect(result.failureCodes).toEqual(['unsigned_contributor']);
  expect(basisOf(result, CO_AUTHOR)?.covered).toBe(false);
});

test.each([
  ['a user entry', [allowlistEntry(7, 'user', CO_AUTHOR)], {}],
  ['a bot entry (an Unknown account may be a bot)', [allowlistEntry(7, 'bot', CO_AUTHOR)], {}],
  [
    'membership of an allowlisted organisation',
    [allowlistEntry(7, 'org_members', 500)],
    { orgMembers: membership([500, [CO_AUTHOR]]) },
  ],
] as const)('a co-author is covered by %s', (_name, allowlist, extra) => {
  const { result } = verdict({ allowlist, ...extra });
  expect(result.outcome).toBe('success');
  expect(basisOf(result, CO_AUTHOR)?.basis).toMatchObject({ kind: 'allowlist', entryId: 7 });
});

test('an organisation member co-author does not cover a non-member co-author of the same commit', () => {
  const other = coAuthoredBy(noreplyEmail(41, 'dave'), 'Dave');
  const { result } = verdict(
    { allowlist: [allowlistEntry(7, 'org_members', 500)], orgMembers: membership([500, [CO_AUTHOR]]) },
    [commit(trailer, other)],
  );
  expect(result.fixes).toEqual([{ code: 'sign_cla', githubId: 41 }]);
  expect(basisOf(result, CO_AUTHOR)?.covered).toBe(true);
});

test('a signed co-author does not make an unsigned author or opener covered', () => {
  const { result } = verdict({ signatures: [signatureFact(1, CO_AUTHOR)] });
  expect(result.fixes).toEqual([
    { code: 'sign_cla', githubId: 1 },
    { code: 'sign_cla', githubId: 2 },
  ]);
});

test('a trailer repeating the unsigned opener id adds no actor and no second failure: the opener fails once', () => {
  const repeat = coAuthoredBy(noreplyEmail(1, 'opener'), 'Opener');
  const { result } = verdict({ signatures: [signatureFact(2, 2)] }, [commit(repeat)]);
  expect(result.actors.map((actor) => actor.account.id)).toEqual([1, 2]);
  expect(result.fixes).toEqual([{ code: 'sign_cla', githubId: 1 }]);
  expect(basisOf(result, 1)?.roles).toEqual(['opener', 'co_author']);
});

test('a trailer repeating the signed opener id cannot make anyone else covered', () => {
  const repeat = coAuthoredBy(noreplyEmail(1, 'opener'), 'Opener');
  const { result } = verdict({ signatures: [signatureFact(1, 1)] }, [commit(repeat)]);
  expect(result.fixes).toEqual([{ code: 'sign_cla', githubId: 2 }]);
});

test.each([
  ['the legacy form', coAuthoredBy('carol@users.noreply.github.com', 'Carol')],
  ['another address', coAuthoredBy('carol@example.org', 'Carol')],
  ['no angle brackets', 'Co-authored-by: Carol'],
  ['an id of 0', coAuthoredBy(noreplyEmail(0, 'carol'), 'Carol')],
  ['an id above the safe range', coAuthoredBy(noreplyEmail(Number.MAX_SAFE_INTEGER + 1, 'carol'), 'Carol')],
] as const)('a trailer with %s is advisory only: the pull request still passes', (_name, line) => {
  const { result, advisories } = verdict({}, [commit(line)]);
  expect(result.outcome).toBe('success');
  expect(result.failureCodes).toEqual([]);
  expect(result.actors.map((actor) => actor.account.id)).toEqual([1, 2]);
  expect(advisories).toEqual([{ code: 'co_author_unresolved', sha: commit().sha }]);
});

test('bot and AI trailers add no actor, no failure and no advisory', () => {
  const { result, advisories } = verdict({}, [
    commit(
      coAuthoredBy('noreply@anthropic.com', 'Claude', 'Co-Authored-By'),
      coAuthoredBy('175728472+Copilot@users.noreply.github.com', 'Copilot'),
      coAuthoredBy('49699333+dependabot[bot]@users.noreply.github.com', 'dependabot[bot]'),
    ),
  ]);
  expect(result.outcome).toBe('success');
  expect(result.actors.map((actor) => actor.account.id)).toEqual([1, 2]);
  expect(advisories).toEqual([]);
});

test('without an active CLA a resolved co-author is listed uncovered with no basis and adds no failure code', () => {
  const { result } = verdict({ policy: null });
  expect(result.failureCodes).toEqual(['no_active_cla']);
  expect(basisOf(result, CO_AUTHOR)).toMatchObject({ covered: false, basis: null });
});
