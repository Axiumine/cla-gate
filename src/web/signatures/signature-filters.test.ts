// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { exactFilterOf, filterKey, isFiltered, queryOf, STATE_FILTERS } from './signature-filters.ts';

// E18-S07: how a search text becomes one of the two exact filters of the endpoint, and what counts as a filter.

test('the states of the filter are the three the export knows, and `all` is none of them', () => {
  expect(STATE_FILTERS).toEqual(['active', 'outdated', 'revoked']);
});

test.each([
  ['a login', 'octocat', 'octocat'],
  ['a login with blanks around it', '  octocat \t', 'octocat'],
  ['digits', '4711', '4711'],
  ['a login of exactly the longest length', 'a'.repeat(100), 'a'.repeat(100)],
  ['a text with an inner blank, which a login cannot have but the server answers nobody for', 'a b', 'a b'],
])('%s is a search as it is, trimmed', (_what, text, expected) => {
  expect(queryOf(text)).toBe(expected);
});

test.each([
  ['nothing', ''],
  ['blanks', ' \t\n '],
  ['a text one character longer than the longest login', 'a'.repeat(101)],
  ['a text with a NUL', 'octo\0cat'],
  ['a text with a lone surrogate', 'octo\uD800cat'],
])('%s is no search: nothing is sent', (_what, text) => {
  expect(queryOf(text)).toBeUndefined();
});

test.each([
  ['digits', '4711', { githubUserId: 4711, login: undefined }],
  ['the smallest id', '1', { githubUserId: 1, login: undefined }],
  ['the largest id a number holds', '9007199254740991', { githubUserId: 9_007_199_254_740_991, login: undefined }],
  ['a login', 'octocat', { githubUserId: undefined, login: 'octocat' }],
  ['a login with digits and a letter', '4711a', { githubUserId: undefined, login: '4711a' }],
  ['digits with a leading zero, which is no id', '0471', { githubUserId: undefined, login: '0471' }],
  ['zero, which is no id', '0', { githubUserId: undefined, login: '0' }],
  [
    'digits beyond what a number holds exactly',
    '9007199254740993',
    { githubUserId: undefined, login: '9007199254740993' },
  ],
  ['a decimal', '4711.5', { githubUserId: undefined, login: '4711.5' }],
  ['a signed number', '-4711', { githubUserId: undefined, login: '-4711' }],
  ['no search', undefined, { githubUserId: undefined, login: undefined }],
])('%s is exactly one exact filter: %j', (_what, text, expected) => {
  expect(exactFilterOf(text)).toEqual(expected);
});

test('a filter is anything that narrows: a search, a status or a document, and none is the whole list', () => {
  expect(isFiltered({ q: undefined, state: undefined, document: undefined })).toBe(false);
  expect(isFiltered({ q: 'octocat', state: undefined, document: undefined })).toBe(true);
  expect(isFiltered({ q: undefined, state: 'revoked', document: undefined })).toBe(true);
  expect(isFiltered({ q: undefined, state: undefined, document: 11 })).toBe(true);
});

test('the key of the filters tells every combination apart, and a missing one from one that says null or all', () => {
  const none = filterKey({ q: undefined, state: undefined, document: undefined });
  const keys = [
    none,
    filterKey({ q: 'octocat', state: undefined, document: undefined }),
    filterKey({ q: undefined, state: 'active', document: undefined }),
    filterKey({ q: undefined, state: undefined, document: 11 }),
    filterKey({ q: '11', state: undefined, document: undefined }),
    filterKey({ q: 'null', state: undefined, document: undefined }),
  ];
  expect(new Set(keys).size).toBe(keys.length);
  expect(filterKey({ q: undefined, state: undefined, document: undefined })).toBe(none);
});
