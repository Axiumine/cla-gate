// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubRepoId, signSearchSchema } from './params.ts';

// E18-S01: what the address of the sign page may hold.

test.each([
  ['1', 1],
  ['123', 123],
  ['987654321', 987654321],
  ['9007199254740991', Number.MAX_SAFE_INTEGER],
])('the repository id %s is %i', (raw, expected) => {
  expect(parseGithubRepoId(raw)).toBe(expected);
});

test.each([
  '',
  '0',
  '00',
  '007',
  '-1',
  '+1',
  '1.0',
  '1e3',
  '0x1F',
  ' 5',
  '5 ',
  '5\n',
  'abc',
  '12abc',
  '١٢٣',
  '9007199254740992',
  '9007199254740993',
  '99999999999999999',
])('%j is not a repository id', (raw) => {
  expect(parseGithubRepoId(raw)).toBeUndefined();
});

test.each([
  [{ pr: 1 }, 1],
  [{ pr: 45 }, 45],
  [{ pr: 2147483647 }, 2147483647],
  [{}, undefined],
  [{ pr: 0 }, undefined],
  [{ pr: -3 }, undefined],
  [{ pr: 2147483648 }, undefined],
  [{ pr: 1.5 }, undefined],
  [{ pr: '45' }, undefined],
  [{ pr: 'abc' }, undefined],
  [{ pr: null }, undefined],
  [{ pr: [4, 5] }, undefined],
  [{ pr: { n: 4 } }, undefined],
])('the search %j holds the pull request %s', (search, expected) => {
  expect(signSearchSchema.parse(search)).toEqual({ pr: expected });
});

test('a search that is not an object is no search at all', () => {
  expect(signSearchSchema.safeParse('pr=4').success).toBe(false);
});
