// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { compareAdvisories, compareShaThenRole, compareText } from './order.ts';

test.each([
  ['equal strings', 'abc', 'abc', 0],
  ['an earlier letter first', 'abc', 'abd', -1],
  ['a later letter second', 'abd', 'abc', 1],
  ['a prefix before its extension', 'ab', 'abc', -1],
  ['an extension after its prefix', 'abc', 'ab', 1],
  ['hex digits before hex letters', '9', 'a', -1],
  ['upper case before lower case, whatever the locale says', 'B', 'a', -1],
  ['the empty string first', '', 'a', -1],
])('compareText orders %s', (_name, a, b, expected) => {
  expect(compareText(a, b)).toBe(expected);
});

test('sorting with compareText is stable across runs and independent of the input order', () => {
  const shas = ['0f', '0a', 'ff', '00', '0A'];
  expect([...shas].sort(compareText)).toEqual(['00', '0A', '0a', '0f', 'ff']);
  expect([...shas].reverse().sort(compareText)).toEqual(['00', '0A', '0a', '0f', 'ff']);
});

test.each([
  ['a lower SHA first, whatever the roles', { sha: 'aa', role: 'committer' }, { sha: 'ab', role: 'author' }, -1],
  ['a higher SHA second, whatever the roles', { sha: 'ab', role: 'author' }, { sha: 'aa', role: 'committer' }, 1],
  ['the same SHA: author before committer', { sha: 'aa', role: 'author' }, { sha: 'aa', role: 'committer' }, -1],
  ['the same SHA: committer after author', { sha: 'aa', role: 'committer' }, { sha: 'aa', role: 'author' }, 1],
  ['the same SHA and role are equal', { sha: 'aa', role: 'author' }, { sha: 'aa', role: 'author' }, 0],
])('compareShaThenRole orders %s', (_name, a, b, expected) => {
  expect(compareShaThenRole(a, b)).toBe(expected);
});

test.each([
  [
    'a lower SHA first, whatever the codes',
    { sha: 'aa', code: 'too_many_trailers' },
    { sha: 'ab', code: 'co_author_unresolved' },
    -1,
  ],
  [
    'a higher SHA second, whatever the codes',
    { sha: 'ab', code: 'co_author_unresolved' },
    { sha: 'aa', code: 'too_many_trailers' },
    1,
  ],
  [
    'the same SHA: co_author_unresolved before too_many_trailers',
    { sha: 'aa', code: 'co_author_unresolved' },
    { sha: 'aa', code: 'too_many_trailers' },
    -1,
  ],
  [
    'the same SHA: too_many_trailers after co_author_unresolved',
    { sha: 'aa', code: 'too_many_trailers' },
    { sha: 'aa', code: 'co_author_unresolved' },
    1,
  ],
  [
    'the same SHA and code are equal',
    { sha: 'aa', code: 'too_many_trailers' },
    { sha: 'aa', code: 'too_many_trailers' },
    0,
  ],
])('compareAdvisories orders %s', (_name, a, b, expected) => {
  expect(compareAdvisories(a, b)).toBe(expected);
});
