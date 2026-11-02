// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { extractActors } from './actors.ts';
import { compareText } from './order.ts';
import { account, commitFacts, evaluationInput, sha, shuffled } from './test-support.ts';

// E08-S02: size, order independence and conflicting facts. `commitsBy(count, authors)` rotates through users 2 and up, who commit their own work.

function commitsBy(count: number, authors: number): ReturnType<typeof commitFacts>[] {
  return Array.from({ length: count }, (_, index) => {
    const author = account((index % authors) + 2);
    return commitFacts(index + 10, { author, committer: author });
  });
}

test.each([
  [250, 250],
  [2000, 2000],
])(
  '%i commits by %i distinct authors give that many actors plus the opener, each with its one commit',
  (count, authors) => {
    const extraction = extractActors(evaluationInput({ commits: commitsBy(count, authors) }));
    expect(extraction.actors).toHaveLength(authors + 1);
    expect(extraction.actors.every((actor) => actor.shas.length <= 1)).toBe(true);
    expect(extraction.actors.reduce((total, actor) => total + actor.shas.length, 0)).toBe(count);
    expect(extraction.mergeCommitsSkipped).toBe(0);
  },
);

test('2000 commits by 3 authors give 3 actors with their commits sorted, plus the opener', () => {
  const extraction = extractActors(evaluationInput({ commits: commitsBy(2000, 3) }));
  expect(extraction.actors.map((actor) => actor.account.id)).toEqual([1, 2, 3, 4]);
  const second = extraction.actors[1];
  expect(second?.shas).toHaveLength(667);
  expect(second?.shas).toEqual([...(second?.shas ?? [])].sort(compareText));
});

test('2000 commits with every tenth a merge count 200 skipped merges', () => {
  const commits = commitsBy(2000, 5).map((commit, index) =>
    index % 10 === 0 ? { ...commit, parents: [sha(1), sha(2)] } : commit,
  );
  const extraction = extractActors(evaluationInput({ commits }));
  expect(extraction.mergeCommitsSkipped).toBe(200);
  expect(extraction.actors.reduce((total, actor) => total + actor.shas.length, 0)).toBe(1800);
});

test.each([1, 2, 3, 4, 5])('shuffling commits (seed %i) does not change the extraction', (seed) => {
  const commits = [
    ...commitsBy(40, 7),
    commitFacts(900, { author: null, committer: account(3) }),
    commitFacts(901, { committer: null }),
    commitFacts(902, { parents: [sha(1), sha(2)] }),
  ];
  const expected = extractActors(evaluationInput({ commits }));
  expect(extractActors(evaluationInput({ commits: shuffled(commits, seed) }))).toEqual(expected);
});

test.each([
  ['a Bot reading beats a User reading', { id: 5, type: 'User' }, { id: 5, type: 'Bot' }, 'Bot'],
  ['a User reading beats Unknown', { id: 5, type: 'Unknown' }, { id: 5, type: 'User' }, 'User'],
  ['Organization beats User', { id: 5, type: 'User' }, { id: 5, type: 'Organization' }, 'Organization'],
  ['Mannequin beats Organization', { id: 5, type: 'Organization' }, { id: 5, type: 'Mannequin' }, 'Mannequin'],
] as const)('one id seen with two types: %s, in either order', (_name, first, second, winner) => {
  const forward = extractActors(evaluationInput({ opener: first, commits: [commitFacts(2, { author: second })] }));
  const backward = extractActors(evaluationInput({ opener: second, commits: [commitFacts(2, { author: first })] }));
  expect(forward.actors.find((actor) => actor.account.id === 5)?.account.type).toBe(winner);
  expect(backward.actors.find((actor) => actor.account.id === 5)?.account.type).toBe(winner);
});

test('one id seen twice with the same type and different slugs keeps one slug, in either order', () => {
  const a = { id: 5, type: 'Bot', appSlug: 'alpha' } as const;
  const b = { id: 5, type: 'Bot', appSlug: 'beta' } as const;
  const none = { id: 5, type: 'Bot' } as const;
  const slugOf = (opener: typeof a | typeof b | typeof none, author: typeof a | typeof b | typeof none) =>
    extractActors(evaluationInput({ opener, commits: [commitFacts(2, { author })] })).actors.find(
      (actor) => actor.account.id === 5,
    )?.account.appSlug;
  expect(slugOf(a, b)).toBe('alpha');
  expect(slugOf(b, a)).toBe('alpha');
  expect(slugOf(none, a)).toBeUndefined();
  expect(slugOf(a, none)).toBeUndefined();
});

test('the extraction of an input does not change the input', () => {
  const commits = [commitFacts(3), commitFacts(2, { committer: null })];
  const input = evaluationInput({ commits });
  const before = structuredClone(input);
  extractActors(input);
  expect(input).toEqual(before);
});
