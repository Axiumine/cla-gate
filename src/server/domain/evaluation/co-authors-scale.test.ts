// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { extractActors } from './actors.ts';
import { addCoAuthors } from './co-authors.ts';
import { compareText } from './order.ts';
import {
  coAuthoredBy,
  commitFacts,
  evaluationInput,
  messageEndingWith,
  noreplyEmail,
  shuffled,
} from './test-support.ts';

// E08-S06: size and order independence. Commit n is by user n + 1 and carries 20 trailers that rotate through 500 ids.

const trailerLines = (commitIndex: number): string[] =>
  Array.from({ length: 20 }, (_unused, k) => {
    const id = 10_000 + ((commitIndex * 20 + k) % 500);
    return coAuthoredBy(noreplyEmail(id, `user${id}`));
  });

const commits = Array.from({ length: 2000 }, (_unused, index) =>
  commitFacts(index + 2, { message: messageEndingWith(...trailerLines(index)) }),
);

test('2,000 commits with 20 trailers each give 500 co-authors, each with its commits sorted, and no advisory', () => {
  const extraction = extractActors(evaluationInput({ commits }));
  const result = addCoAuthors(extraction, commits);
  const coAuthors = result.actors.filter((actor) => actor.roles.includes('co_author'));
  expect(coAuthors).toHaveLength(500);
  expect(coAuthors.every((actor) => actor.account.type === 'Unknown' && actor.shas.length === 80)).toBe(true);
  expect(
    coAuthors.every((actor) => actor.shas.every((sha, i, all) => i === 0 || compareText(all[i - 1] ?? '', sha) < 0)),
  ).toBe(true);
  expect(result.actors).toHaveLength(2000 + 500 + 1);
  expect(result.advisories).toEqual([]);
});

test.each([1, 2, 3])('shuffling the commits (seed %i) changes nothing', (seed) => {
  const sample = commits.slice(0, 300);
  const base = addCoAuthors(extractActors(evaluationInput({ commits: sample })), sample);
  const mixed = shuffled(sample, seed);
  expect(addCoAuthors(extractActors(evaluationInput({ commits: mixed })), mixed)).toEqual(base);
});
