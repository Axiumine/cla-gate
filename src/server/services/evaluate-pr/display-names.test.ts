// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { account, commit, commitSha, pullRequest } from '../github-pull-contract/test-support.ts';
import { displayNamesOf } from './display-names.ts';

// The lookup the job hands to the reporter (E09-S03): the logins of the accounts it saw and the names of the unresolved
// co-author trailers, taken from the data it fetched.

const TRAILER = 'Subject\n\nBody.\n\nCo-authored-by: Jane Roe <jane@example.org>';

test('the logins are those the job saw, by numeric id: the opener first, then each author and committer, the first login of an id winning', () => {
  const pr = pullRequest(5, { opener: account(7) });
  const commits = [
    commit(1, { committer: account(9) }),
    commit(2, { author: { ...account(1), login: 'renamed' } }),
    commit(3),
  ];
  const { logins } = displayNamesOf(pr, commits);
  expect([...logins]).toEqual([
    [7, 'user-7'],
    [1, 'user-1'],
    [9, 'user-9'],
    [2, 'user-2'],
    [3, 'user-3'],
  ]);
});

test('an unlinked author or committer has no login to take', () => {
  const pr = pullRequest(5, { opener: account(7) });
  const { logins } = displayNamesOf(pr, [commit(1, { author: null, committer: null })]);
  expect([...logins]).toEqual([[7, 'user-7']]);
});

test('the names of the unresolved trailers are kept by lower-case commit SHA, and a commit without one is not in the map', () => {
  const pr = pullRequest(5);
  // A SHA with hex letters: in `commitSha(2)` every digit is a number, so upper-casing it would change nothing.
  const lettered = commitSha(0xabc);
  const upper = commit(2, { sha: lettered.toUpperCase(), message: TRAILER });
  expect(upper.sha).not.toBe(lettered);
  const { coAuthors } = displayNamesOf(pr, [commit(1), upper]);
  expect([...coAuthors]).toEqual([[lettered, ['Jane Roe']]]);
});

test('a trailer that resolves to an account, and a bot trailer, give no name', () => {
  const resolved = 'Subject\n\nBody.\n\nCo-authored-by: Ada <12+ada@users.noreply.github.com>';
  const bot = 'Subject\n\nBody.\n\nCo-authored-by: bot <49699333+dependabot[bot]@users.noreply.github.com>';
  const { coAuthors } = displayNamesOf(pullRequest(5), [commit(1, { message: resolved }), commit(2, { message: bot })]);
  expect(coAuthors.size).toBe(0);
});

test('a pull request with no commits has the login of its opener only', () => {
  const names = displayNamesOf(pullRequest(5, { opener: account(7) }), []);
  expect([...names.logins]).toEqual([[7, 'user-7']]);
  expect(names.coAuthors.size).toBe(0);
});
