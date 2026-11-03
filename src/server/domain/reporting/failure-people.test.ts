// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { DisplayNames } from './display-names.ts';
import { InvalidIdError } from './encode.ts';
import type { ReportedRole } from './failure-input.ts';
import { unsignedPeople } from './failure-people.ts';
import { actor, evaluationOf } from './test-support.ts';

// E09-S03, the `Not signed` section: each person who is not covered appears once, keyed by the numeric GitHub id, with the
// login the job saw and the roles the person plays.

const names = (...logins: readonly (readonly [number, string])[]): DisplayNames => ({
  logins: new Map(logins),
  coAuthors: new Map(),
});

test('a person is ``- `login` (GitHub id N): roles``, the id shown so that a recycled login cannot be mistaken for the signer', () => {
  const people = unsignedPeople(
    evaluationOf({ actors: [actor(583231, ['opener', 'author'])] }),
    names([583231, 'octocat']),
  );
  expect(people.entries).toEqual(['- `octocat` (GitHub id 583231): opened the PR, commit author']);
  expect(people.count).toBe(1);
});

test.each([
  ['the opener', ['opener'], 'opened the PR'],
  ['an author', ['author'], 'commit author'],
  ['a committer', ['committer'], 'committer'],
  ['a co-author named by a trailer', ['co_author'], 'co-author'],
  [
    'all four, in this order whatever the order they come in',
    ['co_author', 'committer', 'author', 'opener'],
    'opened the PR, commit author, committer, co-author',
  ],
  ['author and committer', ['committer', 'author'], 'commit author, committer'],
] as const)('%s is named with the words %j', (_what, roles: readonly ReportedRole[], words) => {
  const [entry] = unsignedPeople(evaluationOf({ actors: [actor(5, roles)] }), names([5, 'x'])).entries;
  expect(entry).toBe(`- \`x\` (GitHub id 5): ${words}`);
});

test('an actor with no role is listed with its id and no roles', () => {
  const [entry] = unsignedPeople(evaluationOf({ actors: [actor(5, [])] }), names([5, 'x'])).entries;
  expect(entry).toBe('- `x` (GitHub id 5)');
});

test('an account the job saw no login for is shown as unnamed beside its id', () => {
  const [entry] = unsignedPeople(evaluationOf({ actors: [actor(5, ['co_author'])] }), names()).entries;
  expect(entry).toBe('- `(unnamed)` (GitHub id 5): co-author');
});

test('only the people who are not covered are listed, and they are listed by numeric id, not in the order given', () => {
  const people = unsignedPeople(
    evaluationOf({ actors: [actor(30), actor(4, ['opener'], true), actor(10), actor(20, ['committer'])] }),
    names([30, 'c'], [10, 'a'], [20, 'b'], [4, 'covered']),
  );
  expect(people.entries.map((entry) => entry.slice(0, 14))).toEqual([
    '- `a` (GitHub ',
    '- `b` (GitHub ',
    '- `c` (GitHub ',
  ]);
  expect(people.entries.join('\n')).not.toContain('covered');
  expect(people.count).toBe(3);
});

test('a person who is two actors appears once, with the roles of both', () => {
  const people = unsignedPeople(
    evaluationOf({ actors: [actor(5, ['author']), actor(5, ['committer', 'opener'])] }),
    names([5, 'x']),
  );
  expect(people.entries).toEqual(['- `x` (GitHub id 5): opened the PR, commit author, committer']);
  expect(people.count).toBe(1);
});

test('two accounts that share a login are two people, told apart by their ids', () => {
  const people = unsignedPeople(evaluationOf({ actors: [actor(1), actor(2)] }), names([1, 'same'], [2, 'same']));
  expect(people.entries).toEqual(['- `same` (GitHub id 1): commit author', '- `same` (GitHub id 2): commit author']);
});

test('nobody is listed when everyone is covered, and then nobody can sign', () => {
  expect(unsignedPeople(evaluationOf({ actors: [actor(1, ['opener'], true)] }), names())).toEqual({
    entries: [],
    count: 0,
    canSign: false,
  });
});

test('a person can sign, and so can an account with no fix that says otherwise', () => {
  expect(
    unsignedPeople(evaluationOf({ actors: [actor(1)], fixes: [{ code: 'sign_cla', githubId: 1 }] }), names()).canSign,
  ).toBe(true);
  expect(unsignedPeople(evaluationOf({ actors: [actor(1)] }), names()).canSign).toBe(true);
});

test.each([
  ['a bot', 'allowlist_bot', 'a bot cannot sign; a maintainer can add it to the allowlist'],
  [
    'an account that is not a person',
    'allowlist_account',
    'this account cannot sign; a maintainer can add it to the allowlist',
  ],
] as const)(
  '%s is told that it cannot sign, and is not counted as someone the sign link is for',
  (_what, code, note) => {
    const people = unsignedPeople(
      evaluationOf({ actors: [actor(7, ['opener'])], fixes: [{ code, githubId: 7 }] }),
      names([7, 'dependabot[bot]']),
    );
    expect(people.entries).toEqual([`- \`dependabot[bot]\` (GitHub id 7): opened the PR (${note})`]);
    expect(people.count).toBe(1);
    expect(people.canSign).toBe(false);
  },
);

test('the sign link stays when a bot and a person are both unsigned, and only the bot has the note', () => {
  const people = unsignedPeople(
    evaluationOf({
      actors: [actor(7, ['author']), actor(8, ['author'])],
      fixes: [
        { code: 'allowlist_bot', githubId: 7 },
        { code: 'sign_cla', githubId: 8 },
      ],
    }),
    names([7, 'bot'], [8, 'person']),
  );
  expect(people.entries).toEqual([
    '- `bot` (GitHub id 7): commit author (a bot cannot sign; a maintainer can add it to the allowlist)',
    '- `person` (GitHub id 8): commit author',
  ]);
  expect(people.canSign).toBe(true);
});

test('fixes of other codes, and one that names no account, change nothing', () => {
  const people = unsignedPeople(
    evaluationOf({
      actors: [actor(7)],
      fixes: [{ code: 'split_pull_request' }, { code: 'link_commit_email' }, { code: 'allowlist_bot' }],
    }),
    names([7, 'x']),
  );
  expect(people.entries).toEqual(['- `x` (GitHub id 7): commit author']);
  expect(people.canSign).toBe(true);
});

test('an id that is not a safe integer is an error, never a rounded number', () => {
  expect(() => unsignedPeople(evaluationOf({ actors: [actor(2 ** 53)] }), names())).toThrow(InvalidIdError);
});

test('a login that is hostile is a code span with a fence longer than any run inside, and nothing else', () => {
  const [entry] = unsignedPeople(evaluationOf({ actors: [actor(5)] }), names([5, '@everyone `x` <b>'])).entries;
  expect(entry).toBe('- ``@\u200Beveryone `x` <b>`` (GitHub id 5): commit author');
});
