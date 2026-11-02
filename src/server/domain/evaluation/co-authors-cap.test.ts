// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { extractActors } from './actors.ts';
import { addCoAuthors, MAX_TRAILER_ONLY_ACTORS } from './co-authors.ts';
import {
  coAuthoredBy,
  commitFacts,
  evaluationInput,
  messageEndingWith,
  noreplyEmail,
  sha,
  shuffled,
} from './test-support.ts';
import type { CommitFacts } from './types.ts';

// E08-S06: what a trailer can cost. A trailer is text anyone can write, so the accounts that only trailers name are
// capped per pull request, and the advisories are one per commit and code.

const FIRST = 5_000_000;
const co = (id: number): string => coAuthoredBy(noreplyEmail(id, `user${id}`));
const withTrailers = (n: number, ...lines: readonly string[]): CommitFacts =>
  commitFacts(n, { message: messageEndingWith(...lines) });

function run(commits: readonly CommitFacts[]): ReturnType<typeof addCoAuthors> {
  return addCoAuthors(extractActors(evaluationInput({ commits })), commits);
}

const coAuthorIds = (result: ReturnType<typeof addCoAuthors>): number[] =>
  result.actors.filter((actor) => actor.roles.includes('co_author')).map((actor) => actor.account.id);

/** Commit `n` (n = 2 ...) names the 20 accounts FIRST + 20 (n - 2) ... FIRST + 20 (n - 2) + 19. */
const spam = (commitCount: number): CommitFacts[] =>
  Array.from({ length: commitCount }, (_unused, index) =>
    withTrailers(index + 2, ...Array.from({ length: 20 }, (_u, k) => co(FIRST + index * 20 + k))),
  );

test('the limit is 200 accounts that only trailers name', () => {
  expect(MAX_TRAILER_ONLY_ACTORS).toBe(200);
});

test('200 accounts named only in trailers are all actors, with no advisory', () => {
  const result = run(spam(10));
  expect(coAuthorIds(result)).toHaveLength(200);
  expect(result.advisories).toEqual([]);
});

test('the 201st account is dropped, and the commit that named it gets too_many_trailers', () => {
  const commits = [...spam(10), withTrailers(12, co(FIRST + 1_000_000))];
  const result = run(commits);
  expect(coAuthorIds(result)).toHaveLength(200);
  expect(coAuthorIds(result)).not.toContain(FIRST + 1_000_000);
  expect(result.advisories).toEqual([{ code: 'too_many_trailers', sha: sha(12) }]);
});

test('the accounts kept are the lowest ids, whatever the order of the commits', () => {
  const commits = spam(20);
  const expected = Array.from({ length: 200 }, (_unused, index) => FIRST + index);
  expect(coAuthorIds(run(commits))).toEqual(expected);
  for (const seed of [1, 2, 3]) {
    const mixed = shuffled(commits, seed);
    expect(coAuthorIds(run(mixed))).toEqual(expected);
    expect(run(mixed).advisories).toEqual(run(commits).advisories);
  }
});

test('2,000 commits with 20 distinct trailers each give 200 co-authors and one advisory per commit that lost some', () => {
  const result = run(spam(2000));
  expect(coAuthorIds(result)).toHaveLength(200);
  expect(result.actors).toHaveLength(1 + 2000 + 200);
  expect(result.advisories).toHaveLength(1990);
  expect(new Set(result.advisories.map((advisory) => advisory.sha)).size).toBe(1990);
  expect(result.advisories.every((advisory) => advisory.code === 'too_many_trailers')).toBe(true);
});

test('naming the opener, an author or a committer adds a role, not an account, so it never counts against the limit', () => {
  const authors = Array.from({ length: 300 }, (_unused, index) =>
    withTrailers(index + 2, co(index + 2), ...Array.from({ length: 19 }, (_u, k) => co(FIRST + index * 19 + k))),
  );
  const result = run(authors);
  const named = result.actors.filter((actor) => actor.roles.includes('author') && actor.roles.includes('co_author'));
  expect(named).toHaveLength(300);
  expect(coAuthorIds(result).filter((id) => id >= FIRST)).toHaveLength(200);
});

test('an advisory is unique per commit and code: three unresolved trailers are one advisory', () => {
  const unresolved = 'Co-authored-by: nobody';
  const result = run([withTrailers(2, unresolved, unresolved, 'Co-authored-by: other <x@example.org>')]);
  expect(result.advisories).toEqual([{ code: 'co_author_unresolved', sha: sha(2) }]);
});

test('a commit with 21 trailers that also lost accounts to the limit has one too_many_trailers', () => {
  const crowded = withTrailers(50, ...Array.from({ length: 21 }, (_unused, k) => co(FIRST + 1_000_000 + k)));
  const result = run([...spam(10), crowded]);
  expect(result.advisories).toEqual([{ code: 'too_many_trailers', sha: sha(50) }]);
});

test('one commit can carry both advisories, an unresolved trailer and too many trailers', () => {
  const unresolved = Array.from({ length: 21 }, (_unused, k) => `Co-authored-by: nobody${k} <x${k}@example.org>`);
  const result = run([withTrailers(2, ...unresolved)]);
  expect(result.advisories).toEqual([
    { code: 'co_author_unresolved', sha: sha(2) },
    { code: 'too_many_trailers', sha: sha(2) },
  ]);
});
