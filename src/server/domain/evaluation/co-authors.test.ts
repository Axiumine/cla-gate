// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { advisorySchema } from '../../../shared/pr-evaluation-parts.ts';
import { extractActors } from './actors.ts';
import { addCoAuthors } from './co-authors.ts';
import {
  account,
  actorRows,
  coAuthoredBy,
  commitFacts,
  evaluationInput,
  messageEndingWith,
  noreplyEmail,
  sha,
} from './test-support.ts';
import type { CommitFacts } from './types.ts';

// E08-S06: from trailers to actors. The opener is user 1 and the commit authors are users 2, 3, ... (commitFacts(n)).
// Each row builds commits, runs extraction and addCoAuthors, and names the actors (id, roles, commits) and advisories.

const co = (id: number, name = 'Some Person'): string => coAuthoredBy(noreplyEmail(id, `user${id}`), name);
const withTrailers = (n: number, ...lines: readonly string[]): CommitFacts =>
  commitFacts(n, { message: messageEndingWith(...lines) });

function run(commits: readonly CommitFacts[]): ReturnType<typeof addCoAuthors> {
  const input = evaluationInput({ commits });
  return addCoAuthors(extractActors(input), commits);
}

test('a resolved co-author is an actor with the role co_author, the type Unknown and the commit it appears in', () => {
  const result = run([withTrailers(2, co(40))]);
  expect(actorRows(result)).toEqual([
    { id: 1, roles: ['opener'], shas: [] },
    { id: 2, roles: ['author'], shas: [sha(2)] },
    { id: 40, roles: ['co_author'], shas: [sha(2)] },
  ]);
  expect(result.actors.find((actor) => actor.account.id === 40)?.account).toEqual({ id: 40, type: 'Unknown' });
  expect(result.advisories).toEqual([]);
});

test.each([
  ['the PR opener', 1, 'User', [{ id: 1, roles: ['opener', 'co_author'], shas: [sha(2)] }]],
  ['the author of the same commit', 2, 'User', [{ id: 2, roles: ['author', 'co_author'], shas: [sha(2)] }]],
] as const)('a trailer repeating the id of %s merges into that actor and adds nobody', (_name, id, type, expected) => {
  const result = run([withTrailers(2, co(id))]);
  expect(actorRows(result).filter((row) => row.id === id)).toEqual(expected);
  expect(result.actors.map((actor) => actor.account.id)).toEqual([1, 2]);
  expect(result.actors.find((actor) => actor.account.id === id)?.account.type).toBe(type);
});

test('a trailer that claims the id of a known bot leaves the bot a bot', () => {
  const commit = withTrailers(2, co(2));
  const result = addCoAuthors(extractActors(evaluationInput({ commits: [{ ...commit, author: account(2, 'Bot') }] })), [
    commit,
  ]);
  expect(result.actors.find((actor) => actor.account.id === 2)).toEqual({
    account: { id: 2, type: 'Bot' },
    roles: ['author', 'co_author'],
    shas: [sha(2)],
  });
});

test('a trailer that claims the id of the committer merges into the committer', () => {
  const commit = { ...withTrailers(2, co(7)), committer: account(7) };
  const result = run([commit]);
  expect(actorRows(result).filter((row) => row.id === 7)).toEqual([
    { id: 7, roles: ['committer', 'co_author'], shas: [sha(2)] },
  ]);
});

test('the same co-author in two commits is one actor with both commits, sorted', () => {
  const result = run([withTrailers(3, co(40)), withTrailers(2, co(40))]);
  expect(actorRows(result).filter((row) => row.id === 40)).toEqual([
    { id: 40, roles: ['co_author'], shas: [sha(2), sha(3)] },
  ]);
});

test('several co-authors come out sorted by id, whatever the order they were written in', () => {
  const result = run([withTrailers(2, co(900), co(40), co(7))]);
  expect(result.actors.map((actor) => actor.account.id)).toEqual([1, 2, 7, 40, 900]);
});

test.each([
  ['two parents', ['aa', 'bb'], false],
  ['three parents (an octopus merge)', ['aa', 'bb', 'cc'], false],
  ['one parent', ['aa'], true],
  ['no parent (a root commit)', [], true],
] as const)('the trailers of a commit with %s are read: %s', (_name, parents, isRead) => {
  const result = run([withTrailers(2, co(40), 'Co-authored-by: nobody')].map((c) => ({ ...c, parents })));
  expect(result.actors.some((actor) => actor.account.id === 40)).toBe(isRead);
  expect(result.advisories).toEqual(isRead ? [{ code: 'co_author_unresolved', sha: sha(2) }] : []);
});

test('a merge commit is skipped even when it carries the only trailer that would name an actor', () => {
  const merge = { ...withTrailers(2, co(40)), parents: [sha(1), sha(5)] };
  const result = run([merge, withTrailers(3, co(41))]);
  expect(result.actors.map((actor) => actor.account.id)).toEqual([1, 3, 41]);
  expect(result.mergeCommitsSkipped).toBe(1);
});

test('a commit listed twice is read once, under its lower-case SHA, so its advisory is not doubled', () => {
  const commit = withTrailers(2, 'Co-authored-by: nobody');
  const result = run([commit, { ...commit, sha: commit.sha.toUpperCase() }, commit]);
  expect(result.advisories).toEqual([{ code: 'co_author_unresolved', sha: sha(2) }]);
});

test('advisories are sorted by SHA, then code, and do not depend on the order of the commits', () => {
  const many = Array.from({ length: 21 }, (_unused, i) => co(100 + i));
  const commits = [
    withTrailers(9, 'Co-authored-by: nobody'),
    withTrailers(4, ...many, 'Co-authored-by: nobody'),
    withTrailers(6, 'x'),
  ];
  const expected = [
    { code: 'too_many_trailers', sha: sha(4) },
    { code: 'co_author_unresolved', sha: sha(9) },
  ];
  expect(run(commits).advisories).toEqual(expected);
  expect(run([...commits].reverse()).advisories).toEqual(expected);
});

test('an advisory holds a code and a SHA and nothing else, whatever the hostile trailer said', () => {
  const hostile = `Co-authored-by: **@everyone** #12 ${String.fromCodePoint(0x202e)} <attacker@example.org>`;
  const result = run([withTrailers(2, hostile)]);
  expect(result.advisories).toEqual([{ code: 'co_author_unresolved', sha: sha(2) }]);
  expect(JSON.stringify(result.advisories)).not.toMatch(/everyone|attacker|#12/i);
  expect(advisorySchema.array().safeParse(result.advisories).success).toBe(true);
});

test('what extraction found besides actors is passed on untouched', () => {
  const commits = [
    withTrailers(2, co(40)),
    { ...commitFacts(3), author: null },
    { ...commitFacts(4), parents: ['a', 'b'] },
  ];
  const extraction = extractActors(evaluationInput({ commits }));
  const result = addCoAuthors(extraction, commits);
  expect(result.unlinked).toBe(extraction.unlinked);
  expect(result.mergeCommitsSkipped).toBe(1);
  expect(result.unlinked.map((finding) => finding.sha)).toEqual([sha(3)]);
});

test('no commits, or commits without trailers: the extraction is returned with no advisories', () => {
  const commits = [commitFacts(2), commitFacts(3, { message: '' })];
  const extraction = extractActors(evaluationInput({ commits }));
  expect(addCoAuthors(extraction, [])).toEqual({ ...extraction, advisories: [] });
  expect(addCoAuthors(extraction, commits)).toEqual({ ...extraction, advisories: [] });
});
