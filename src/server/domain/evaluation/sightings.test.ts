// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { ExtractedActor } from './actor-types.ts';
import { mergeActors } from './sightings.ts';
import { extractedActor, sha } from './test-support.ts';

// E08-S06: two lists of actors become one, by numeric id. The list of the opener and the commit identities comes from
// extraction (E08-S02); the one of the trailers from addCoAuthors.

const rows = (actors: readonly ExtractedActor[]): readonly unknown[] =>
  actors.map((actor) => [actor.account.id, actor.account.type, actor.roles, actor.shas]);

test('lists with different ids are joined and sorted by id', () => {
  const merged = mergeActors(
    [extractedActor(9, 'User', ['author'], [sha(1)])],
    [extractedActor(3, 'Unknown', ['co_author'], [sha(2)])],
  );
  expect(rows(merged)).toEqual([
    [3, 'Unknown', ['co_author'], [sha(2)]],
    [9, 'User', ['author'], [sha(1)]],
  ]);
});

test('the same id becomes one actor with the union of roles in the closed order and of commits, sorted', () => {
  const merged = mergeActors(
    [extractedActor(5, 'User', ['committer', 'opener'], [sha(7), sha(3)])],
    [extractedActor(5, 'User', ['co_author', 'author'], [sha(3), sha(1)])],
  );
  expect(rows(merged)).toEqual([[5, 'User', ['opener', 'author', 'committer', 'co_author'], [sha(1), sha(3), sha(7)]]]);
});

test.each([
  ['a person known as User beats an Unknown co-author', 'User', 'Unknown', 'User'],
  ['and the other way round', 'Unknown', 'User', 'User'],
  ['a known Bot beats an Unknown co-author', 'Bot', 'Unknown', 'Bot'],
  ['and the other way round for a bot', 'Unknown', 'Bot', 'Bot'],
  ['Bot beats User when two facts disagree', 'User', 'Bot', 'Bot'],
] as const)('%s', (_name, firstType, secondType, expected) => {
  const merged = mergeActors(
    [extractedActor(5, firstType, ['author'])],
    [extractedActor(5, secondType, ['co_author'])],
  );
  expect(merged.map((actor) => actor.account.type)).toEqual([expected]);
});

test('the input lists and their actors are not changed', () => {
  const first = Object.freeze([
    Object.freeze({
      ...extractedActor(5, 'User', ['author'], [sha(1)]),
      roles: Object.freeze(['author' as const]),
      shas: Object.freeze([sha(1)]),
    }),
  ]);
  const second = Object.freeze([
    Object.freeze({
      ...extractedActor(5, 'Unknown', ['co_author'], [sha(2)]),
      roles: Object.freeze(['co_author' as const]),
      shas: Object.freeze([sha(2)]),
    }),
  ]);
  expect(rows(mergeActors(first, second))).toEqual([[5, 'User', ['author', 'co_author'], [sha(1), sha(2)]]]);
  expect(rows(first)).toEqual([[5, 'User', ['author'], [sha(1)]]]);
});

test('two empty lists give an empty list', () => {
  expect(mergeActors([], [])).toEqual([]);
});
