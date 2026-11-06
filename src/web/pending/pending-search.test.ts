// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { PENDING_TABS, pendingSearchSchema, tabFromValue, tabOf } from './pending-search.ts';

// E18-S08: the address of the pending screen holds the tab, the repository, the reason and the cursor; whatever is not one of them is
// dropped instead of failing the page.

test('an address with all four values keeps them', () => {
  expect(
    pendingSearchSchema.parse({ tab: 'overrides', repository: 7, reason: 'unlinked_identity', cursor: 'c2' }),
  ).toEqual({ tab: 'overrides', repository: 7, reason: 'unlinked_identity', cursor: 'c2' });
});

test('an address with nothing is the first tab with no filter', () => {
  expect(pendingSearchSchema.parse({})).toEqual({});
  expect(tabOf({})).toBe('pending');
});

test('the two tabs are the pending list and the overrides, and ?tab=overrides is the second', () => {
  expect(PENDING_TABS).toEqual(['pending', 'overrides']);
  expect(tabOf({ tab: 'overrides' })).toBe('overrides');
});

test.each([
  ['the value of the second tab', 'overrides', 'overrides'],
  ['the value of the first tab', 'pending', 'pending'],
  ['a value that is no tab', 'audit', 'pending'],
  ['no text', '', 'pending'],
])('the Radix value %s is the tab %s', (_what, value, tab) => {
  expect(tabFromValue(value)).toBe(tab);
});

test.each([
  ['the tab `pending`, which is no parameter', { tab: 'pending' }],
  ['a tab the screen does not have', { tab: 'audit' }],
  ['a tab that is a number', { tab: 3 }],
])('?tab= of %s is dropped', (_what, input) => {
  expect(pendingSearchSchema.parse(input)).toEqual({});
});

test.each([
  ['text', 'acme'],
  ['zero', 0],
  ['a negative number', -3],
  ['a decimal', 1.5],
  ['a number beyond a safe integer', 1e21],
  ['a list', [1, 2]],
])('?repository= of %s is dropped', (_what, repository) => {
  expect(pendingSearchSchema.parse({ repository })).toEqual({});
});

test.each([
  'unsigned_contributor',
  'bot_not_allowlisted',
  'unlinked_identity',
  'no_active_cla',
  'commit_limit_exceeded',
  'other',
])('?reason=%s is kept', (reason) => {
  expect(pendingSearchSchema.parse({ reason })).toEqual({ reason });
});

test.each([
  ['a reason the list does not know', 'expired'],
  ['an empty reason', ''],
  ['a number', 3],
])('?reason= of %s is dropped', (_what, reason) => {
  expect(pendingSearchSchema.parse({ reason })).toEqual({});
});

test.each([
  ['an empty value', ''],
  ['a number', 123],
  ['a list', ['a']],
  ['a text of 1025 characters', 'a'.repeat(1025)],
])('?cursor= of %s is dropped', (_what, cursor) => {
  expect(pendingSearchSchema.parse({ cursor })).toEqual({});
});

test('a cursor of 1024 characters is kept, and an invalid value does not take the valid ones with it', () => {
  expect(pendingSearchSchema.parse({ cursor: 'a'.repeat(1024) })).toEqual({ cursor: 'a'.repeat(1024) });
  expect(pendingSearchSchema.parse({ repository: 'x', reason: 'other' })).toEqual({ reason: 'other' });
});
