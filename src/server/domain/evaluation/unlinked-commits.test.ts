// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { extractActors } from './actors.ts';
import { assessCoverage } from './coverage.ts';
import { GITHUB_WEB_FLOW_ID } from './github-identities.ts';
import { account, commitFacts, evaluationInput, sha, signatureFact } from './test-support.ts';
import type { CommitFacts, EvaluationInput, FailureCode } from './types.ts';
import { assessUnlinked } from './unlinked.ts';

// E08-S05 from commits to verdict: extraction (S02), coverage (S04) and the unlinked assessment run on the same input,
// the way the composition (E08-S08) will run them. The opener (user 1) and user 2 have signed unless a row says so.
// Each row names the failure codes of coverage and of the unlinked rule separately, so a row shows which rule spoke.

const WEB_FLOW = account(GITHUB_WEB_FLOW_ID);

function run(input: EvaluationInput): {
  readonly coverageCodes: readonly FailureCode[];
  readonly unlinkedCodes: readonly FailureCode[];
  readonly unsigned: readonly number[];
  readonly overridden: readonly (string | null)[];
} {
  const extraction = extractActors(input);
  const coverage = assessCoverage(input, extraction.actors);
  const unlinked = assessUnlinked(extraction.unlinked, input.overrides);
  return {
    coverageCodes: coverage.failureCodes,
    unlinkedCodes: unlinked.failureCodes,
    unsigned: coverage.actors.filter((actor) => !actor.covered).map((actor) => actor.account.id),
    overridden: unlinked.findings.map((finding) =>
      finding.overrideId === null ? null : `${finding.role}:${finding.overrideId}`,
    ),
  };
}

function input(
  commits: readonly CommitFacts[],
  overrides: readonly (readonly [string, number])[] = [],
): EvaluationInput {
  return evaluationInput({
    commits,
    overrides: new Map(overrides),
    signatures: [signatureFact(1, 1), signatureFact(2, 2)],
  });
}

const unlinkedAuthor = (n: number, overrides: Partial<CommitFacts> = {}): CommitFacts =>
  commitFacts(n, { author: null, committer: WEB_FLOW, ...overrides });

interface Row {
  readonly name: string;
  readonly commits: readonly CommitFacts[];
  readonly overrides: readonly (readonly [string, number])[];
  readonly unlinkedCodes: readonly FailureCode[];
  readonly overridden: readonly (string | null)[];
}

const SHA_64 = 'ef'.repeat(32);

const rows: readonly Row[] = [
  {
    name: 'unlinked author',
    commits: [unlinkedAuthor(10)],
    overrides: [],
    unlinkedCodes: ['unlinked_identity'],
    overridden: [null],
  },
  {
    name: 'unlinked committer, linked signed author',
    commits: [commitFacts(2, { committer: null })],
    overrides: [],
    unlinkedCodes: ['unlinked_identity'],
    overridden: [null],
  },
  {
    name: 'author and committer both unlinked',
    commits: [commitFacts(10, { author: null, committer: null })],
    overrides: [],
    unlinkedCodes: ['unlinked_identity'],
    overridden: [null, null],
  },
  {
    name: 'an unlinked author, overridden',
    commits: [unlinkedAuthor(10)],
    overrides: [[sha(10), 41]],
    unlinkedCodes: [],
    overridden: ['author:41'],
  },
  {
    name: 'both identities unlinked and one override resolving both',
    commits: [commitFacts(10, { author: null, committer: null })],
    overrides: [[sha(10), 41]],
    unlinkedCodes: [],
    overridden: ['author:41', 'committer:41'],
  },
  {
    name: 'an override for another commit leaves the unlinked author failing',
    commits: [unlinkedAuthor(10)],
    overrides: [[sha(11), 41]],
    unlinkedCodes: ['unlinked_identity'],
    overridden: [null],
  },
  {
    name: 'an override for a SHA that is in no commit of the pull request is ignored',
    commits: [commitFacts(2)],
    overrides: [[sha(99), 41]],
    unlinkedCodes: [],
    overridden: [],
  },
  {
    name: 'an override SHA in upper case matches the commit',
    commits: [unlinkedAuthor(0xabcdef)],
    overrides: [[sha(0xabcdef).toUpperCase(), 41]],
    unlinkedCodes: [],
    overridden: ['author:41'],
  },
  {
    name: 'a commit with a 64-character SHA is overridden by that SHA',
    commits: [unlinkedAuthor(10, { sha: SHA_64 })],
    overrides: [[SHA_64, 41]],
    unlinkedCodes: [],
    overridden: ['author:41'],
  },
  {
    name: 'the same commit listed twice gives one finding, not two',
    commits: [unlinkedAuthor(10), unlinkedAuthor(10)],
    overrides: [],
    unlinkedCodes: ['unlinked_identity'],
    overridden: [null],
  },
  {
    name: 'the same commit listed twice in upper and lower case gives one finding, overridden once',
    commits: [unlinkedAuthor(0xabcdef), unlinkedAuthor(0xabcdef, { sha: sha(0xabcdef).toUpperCase() })],
    overrides: [[sha(0xabcdef), 41]],
    unlinkedCodes: [],
    overridden: ['author:41'],
  },
];

test.each(rows)('$name', ({ commits, overrides, unlinkedCodes, overridden }) => {
  const result = run(input(commits, overrides));
  expect(result.unlinkedCodes).toEqual(unlinkedCodes);
  expect(result.overridden).toEqual(overridden);
  expect(result.unsigned).toEqual([]);
  expect(result.coverageCodes).toEqual([]);
});

test('an override does not cover a linked but unsigned author of the same commit', () => {
  const commit = commitFacts(10, { author: account(7), committer: null });
  const result = run(input([commit], [[sha(10), 41]]));
  expect(result.overridden).toEqual(['committer:41']);
  expect(result.unlinkedCodes).toEqual([]);
  expect(result.unsigned).toEqual([7]);
  expect(result.coverageCodes).toEqual(['unsigned_contributor']);
});

test('an override does not cover a linked but unsigned committer of the same commit', () => {
  const commit = commitFacts(2, { author: null, committer: account(7) });
  const result = run(input([commit], [[sha(2), 41]]));
  expect(result.overridden).toEqual(['author:41']);
  expect(result.unsigned).toEqual([7]);
  expect(result.coverageCodes).toEqual(['unsigned_contributor']);
});

test('an override never signs for the opener: an unsigned opener on an overridden commit still fails', () => {
  const unsignedOpener = evaluationInput({
    opener: account(5),
    commits: [commitFacts(10, { author: account(5), committer: null })],
    overrides: new Map([[sha(10), 41]]),
  });
  const result = run(unsignedOpener);
  expect(result.overridden).toEqual(['committer:41']);
  expect(result.unsigned).toEqual([5]);
  expect(result.coverageCodes).toEqual(['unsigned_contributor']);
});

test('coverage and actors are identical with and without overrides: an override adds no actor and changes no basis', () => {
  const commits = [unlinkedAuthor(10), commitFacts(11, { author: account(7), committer: null }), commitFacts(2)];
  const without = input(commits);
  const withAll = input(commits, [
    [sha(10), 41],
    [sha(11), 42],
    [sha(2), 43],
  ]);
  const plain = extractActors(without);
  expect(extractActors(withAll).actors).toEqual(plain.actors);
  expect(assessCoverage(withAll, extractActors(withAll).actors)).toEqual(assessCoverage(without, plain.actors));
});

test('an email is never mapped to an account: a signer noreply address on an unlinked commit adds no actor', () => {
  const attacker = commitFacts(10, {
    author: null,
    committer: null,
    rawAuthor: { name: 'A Signer', email: '2+signer@users.noreply.github.com' },
    rawCommitter: { name: 'A Signer', email: '2+signer@users.noreply.github.com' },
  });
  const unsignedOpener = evaluationInput({
    opener: account(5),
    commits: [attacker],
    signatures: [signatureFact(2, 2)],
  });
  const extraction = extractActors(unsignedOpener);
  const coverage = assessCoverage(unsignedOpener, extraction.actors);
  expect(extraction.actors.map((actor) => actor.account.id)).toEqual([5]);
  expect(coverage.actors).toMatchObject([{ covered: false, basis: null }]);
  expect(assessUnlinked(extraction.unlinked, unsignedOpener.overrides).failureCodes).toEqual(['unlinked_identity']);
});
