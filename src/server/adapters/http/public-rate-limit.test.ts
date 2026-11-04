// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { repositoryKey } from './public-rate-limit.ts';

// The key of the budget of a repository (E22-S02), without a server: the budgets themselves are shown on the real application in
// public-verification-routes-limits.test.ts.

test.each([
  ['9000', 'repo:9000'],
  ['1', 'repo:1'],
  ['9007199254740991', 'repo:9007199254740991'],
  ['9'.repeat(16), `repo:${'9'.repeat(16)}`],
])('the repository id %s has the bucket %s', (id, key) => {
  expect(repositoryKey({ params: { githubRepoId: id, login: 'octocat' } })).toBe(key);
});

test.each([
  ['zero', '0'],
  ['a leading zero', '09000'],
  ['a sign', '+9000'],
  ['letters', 'abc'],
  ['a decimal', '1.5'],
  ['seventeen digits', '1'.repeat(17)],
  ['an empty string', ''],
  ['a space', '9000 '],
  ['a newline after the digits', '9000\n'],
])('a repository id with %s has the one shared bucket of the ids that are not ids', (_name, id) => {
  expect(repositoryKey({ params: { githubRepoId: id } })).toBe('repo:invalid');
});

test.each([
  ['no params at all', undefined],
  ['params that are null', null],
  ['params that are a string', '9000'],
  ['params that are a number', 9000],
  ['params with no repository id', { login: 'octocat' }],
  ['a repository id that is a number', { githubRepoId: 9000 }],
  ['a repository id that is null', { githubRepoId: null }],
  ['a repository id that is a list', { githubRepoId: ['9000'] }],
])('%s has the one shared bucket of the ids that are not ids', (_name, params) => {
  expect(repositoryKey({ params })).toBe('repo:invalid');
});
