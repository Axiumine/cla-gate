// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { allowlistSearchSchema } from './allowlist-search.ts';

// E18-S06: `?repository=` is a repository id, else nothing: the screen falls back to the whole installation.

test.each([1, 7, 9_007_199_254_740_991])('%i is a repository id and is kept', (repository) => {
  expect(allowlistSearchSchema.parse({ repository })).toEqual({ repository });
});

test('no repository is the whole installation', () => {
  expect(allowlistSearchSchema.parse({})).toEqual({});
});

test.each([
  ['zero', 0],
  ['a negative number', -3],
  ['a decimal', 1.5],
  ['a number beyond a safe integer', 1e21],
  ['a word', 'abc'],
  ['a number written as text', '7'],
  ['a list', [1, 2]],
  ['an object', { id: 1 }],
  ['true', true],
  ['null', null],
])('%s is no repository id: it is dropped instead of failing the page', (_what, repository) => {
  expect(allowlistSearchSchema.parse({ repository })).toEqual({ repository: undefined });
});

test('a key the screen does not know, such as an installation or an account, is dropped', () => {
  expect(allowlistSearchSchema.parse({ repository: 2, installationId: 9, githubId: 3 })).toEqual({ repository: 2 });
});
