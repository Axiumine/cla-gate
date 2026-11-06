// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { repositorySearchSchema } from './repository-search.ts';

// E18-S10: the address of the Repositories screen holds the search, the enforcement filter and the cursor; whatever is not one of them is
// dropped instead of failing the page.

test('an address with all three values keeps them', () => {
  expect(repositorySearchSchema.parse({ q: 'acme/widgets', enabled: true, cursor: 'c2' })).toEqual({
    q: 'acme/widgets',
    enabled: true,
    cursor: 'c2',
  });
});

test('an address with nothing is the whole list', () => {
  expect(repositorySearchSchema.parse({})).toEqual({});
});

test.each([
  ['a name', 'acme/widgets', 'acme/widgets'],
  ['a name with blanks around it', '  widgets ', 'widgets'],
  ['digits as text', '4711', '4711'],
  ['digits that the router read as a number', 4711, '4711'],
  ['a text of exactly the longest length', 'a'.repeat(140), 'a'.repeat(140)],
])('?q= of %s is the search %j', (_what, q, expected) => {
  expect(repositorySearchSchema.parse({ q })).toEqual({ q: expected });
});

test.each([
  ['blanks', '   '],
  ['a text longer than a full name can be', 'a'.repeat(141)],
  ['a text with a NUL', 'a\0b'],
  ['a negative number', -4],
  ['a list', ['a', 'b']],
  ['an object', { q: 'a' }],
  ['true', true],
  ['null', null],
])('?q= of %s is no search: it is dropped', (_what, q) => {
  expect(repositorySearchSchema.parse({ q })).toEqual({ q: undefined });
});

test.each([
  ['true as the router reads it', true, true],
  ['false as the router reads it', false, false],
  ['the word true', 'true', true],
  ['the word false', 'false', false],
])('?enabled= of %s is the filter %s', (_what, enabled, expected) => {
  expect(repositorySearchSchema.parse({ enabled })).toEqual({ enabled: expected });
});

test.each([
  ['a word nobody uses', 'yes'],
  ['the word in capitals', 'TRUE'],
  ['a number', 1],
  ['a list', [true]],
  ['null', null],
])('?enabled= of %s is dropped', (_what, enabled) => {
  expect(repositorySearchSchema.parse({ enabled })).toEqual({ enabled: undefined });
});

test('a cursor of 1 to 1024 characters is kept as it is, and any other is dropped', () => {
  expect(repositorySearchSchema.parse({ cursor: 'x' })).toEqual({ cursor: 'x' });
  expect(repositorySearchSchema.parse({ cursor: 'x'.repeat(1024) })).toEqual({ cursor: 'x'.repeat(1024) });
  expect(repositorySearchSchema.parse({ cursor: '' })).toEqual({ cursor: undefined });
  expect(repositorySearchSchema.parse({ cursor: 'x'.repeat(1025) })).toEqual({ cursor: undefined });
  expect(repositorySearchSchema.parse({ cursor: 4 })).toEqual({ cursor: undefined });
});

test('a key nobody defined is not kept', () => {
  expect(repositorySearchSchema.parse({ q: 'a', installationId: 6 })).toEqual({ q: 'a' });
});
