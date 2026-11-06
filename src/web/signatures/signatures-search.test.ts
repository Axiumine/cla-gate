// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { signaturesSearchSchema } from './signatures-search.ts';

// E18-S07: the address of the signatures screen holds the search, the status, the document and the cursor; whatever is not one of
// them is dropped instead of failing the page.

test('an address with all four values keeps them', () => {
  expect(signaturesSearchSchema.parse({ q: 'octocat', state: 'revoked', document: 11, cursor: 'c2' })).toEqual({
    q: 'octocat',
    state: 'revoked',
    document: 11,
    cursor: 'c2',
  });
});

test('an address with nothing is the whole list', () => {
  expect(signaturesSearchSchema.parse({})).toEqual({});
});

test.each([
  ['a login', 'octocat', 'octocat'],
  ['a login with blanks around it', '  octocat ', 'octocat'],
  ['digits as text', '4711', '4711'],
  ['digits that the router read as a number', 4711, '4711'],
  ['the number zero, which is text of one digit', 0, '0'],
])('?q= of %s is the search %j', (_what, q, expected) => {
  expect(signaturesSearchSchema.parse({ q })).toEqual({ q: expected });
});

test.each([
  ['blanks', '   '],
  ['a text longer than a login can be', 'a'.repeat(101)],
  ['a text with a NUL', 'a\0b'],
  ['a negative number', -4],
  ['a decimal', 1.5],
  ['a number beyond a safe integer', 1e21],
  ['a list', ['a', 'b']],
  ['an object', { q: 'a' }],
  ['true', true],
  ['null', null],
])('?q= of %s is no search: it is dropped', (_what, q) => {
  expect(signaturesSearchSchema.parse({ q })).toEqual({ q: undefined });
});

test.each(['active', 'outdated', 'revoked'])('?state=%s is kept', (state) => {
  expect(signaturesSearchSchema.parse({ state })).toEqual({ state });
});

test.each([
  ['all, which is no state', 'all'],
  ['a state nobody has', 'expired'],
  ['a state in capitals', 'ACTIVE'],
  ['a number', 3],
  ['a list', ['active']],
])('?state= of %s is dropped', (_what, state) => {
  expect(signaturesSearchSchema.parse({ state })).toEqual({ state: undefined });
});

test.each([1, 11, 9_007_199_254_740_991])('?document=%i is kept', (document) => {
  expect(signaturesSearchSchema.parse({ document })).toEqual({ document });
});

test.each([
  ['zero', 0],
  ['a negative number', -1],
  ['a decimal', 1.5],
  ['a number beyond a safe integer', 1e21],
  ['text, even of digits', '11'],
  ['null', null],
])('?document= of %s is dropped', (_what, document) => {
  expect(signaturesSearchSchema.parse({ document })).toEqual({ document: undefined });
});

test('a cursor of 1 to 1024 characters is kept as it is, and any other is dropped', () => {
  expect(signaturesSearchSchema.parse({ cursor: 'x' })).toEqual({ cursor: 'x' });
  expect(signaturesSearchSchema.parse({ cursor: 'x'.repeat(1024) })).toEqual({ cursor: 'x'.repeat(1024) });
  expect(signaturesSearchSchema.parse({ cursor: '' })).toEqual({ cursor: undefined });
  expect(signaturesSearchSchema.parse({ cursor: 'x'.repeat(1025) })).toEqual({ cursor: undefined });
  expect(signaturesSearchSchema.parse({ cursor: 4 })).toEqual({ cursor: undefined });
});

test('a key the screen does not know, such as an installation or an account, is dropped', () => {
  expect(signaturesSearchSchema.parse({ document: 2, installationId: 9, githubUserId: 3 })).toEqual({ document: 2 });
});
