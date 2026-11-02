// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { extractActors } from './actors.ts';
import { account, actorRows, commitFacts, evaluationInput, sha } from './test-support.ts';

// E08-S02: the opener, the roles and the distinct-actor rules. Each row names the people involved by their numeric id.

test('the opener alone is an actor with the role opener and no commits', () => {
  const extraction = extractActors(evaluationInput({ opener: account(1) }));
  expect(actorRows(extraction)).toEqual([{ id: 1, roles: ['opener'], shas: [] }]);
  expect(extraction.unlinked).toEqual([]);
  expect(extraction.mergeCommitsSkipped).toBe(0);
});

test('an input with no commits at all still reports its opener and nothing else', () => {
  const extraction = extractActors(evaluationInput({ commits: [] }));
  expect(extraction).toEqual({
    actors: [{ account: account(1), roles: ['opener'], shas: [] }],
    unlinked: [],
    mergeCommitsSkipped: 0,
  });
});

test.each([
  [
    'opener equals author: one actor, two roles',
    1,
    [commitFacts(1)],
    [{ id: 1, roles: ['opener', 'author'], shas: [sha(1)] }],
  ],
  [
    'opener and a different author: two actors',
    9,
    [commitFacts(2)],
    [
      { id: 2, roles: ['author'], shas: [sha(2)] },
      { id: 9, roles: ['opener'], shas: [] },
    ],
  ],
  [
    'the opener is an actor even when every commit is by someone else',
    1,
    [commitFacts(2), commitFacts(3)],
    [
      { id: 1, roles: ['opener'], shas: [] },
      { id: 2, roles: ['author'], shas: [sha(2)] },
      { id: 3, roles: ['author'], shas: [sha(3)] },
    ],
  ],
  [
    'two commits by the same person are one actor with both SHAs, sorted',
    9,
    [commitFacts(5), commitFacts(4, { author: account(5), committer: account(5) })],
    [
      { id: 5, roles: ['author'], shas: [sha(4), sha(5)] },
      { id: 9, roles: ['opener'], shas: [] },
    ],
  ],
  [
    'the opener who is also a committer of another person commit has both roles',
    1,
    [commitFacts(2, { committer: account(1) })],
    [
      { id: 1, roles: ['opener', 'committer'], shas: [sha(2)] },
      { id: 2, roles: ['author'], shas: [sha(2)] },
    ],
  ],
  [
    'author in one commit and committer of another is one actor with two roles',
    9,
    [commitFacts(2), commitFacts(3, { committer: account(2) })],
    [
      { id: 2, roles: ['author', 'committer'], shas: [sha(2), sha(3)] },
      { id: 3, roles: ['author'], shas: [sha(3)] },
      { id: 9, roles: ['opener'], shas: [] },
    ],
  ],
])('%s', (_name, openerId, commits, expected) => {
  const extraction = extractActors(evaluationInput({ opener: account(openerId), commits }));
  expect(actorRows(extraction)).toEqual(expected);
});

test('roles come out in the order of the closed ROLES list, whatever order they were met in', () => {
  const commits = [
    commitFacts(2, { committer: account(1) }),
    commitFacts(1, { author: account(1), committer: account(1) }),
  ];
  const extraction = extractActors(evaluationInput({ opener: account(1), commits }));
  expect(actorRows(extraction)).toEqual([
    { id: 1, roles: ['opener', 'author', 'committer'], shas: [sha(1), sha(2)] },
    { id: 2, roles: ['author'], shas: [sha(2)] },
  ]);
});

test('actors are sorted by numeric id, not by text', () => {
  const commits = [commitFacts(100), commitFacts(20), commitFacts(3)];
  const extraction = extractActors(evaluationInput({ opener: account(1000), commits }));
  expect(extraction.actors.map((actor) => actor.account.id)).toEqual([3, 20, 100, 1000]);
});

test('the account of an actor is the account the input gave, type and display slug included', () => {
  const bot = { id: 5, type: 'Bot', appSlug: 'dependency-updater' } as const;
  const extraction = extractActors(evaluationInput({ opener: bot }));
  expect(extraction.actors[0]?.account).toEqual(bot);
});

test('a login-looking app slug on a person changes nothing about who the actor is', () => {
  const plain = extractActors(evaluationInput({ opener: { id: 7, type: 'User' } }));
  const slugged = extractActors(evaluationInput({ opener: { id: 7, type: 'User', appSlug: 'web-flow' } }));
  expect(actorRows(slugged)).toEqual(actorRows(plain));
});
