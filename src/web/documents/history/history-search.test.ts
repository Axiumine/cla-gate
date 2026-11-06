// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  type DocumentSearch,
  documentSearchSchema,
  panelOf,
  tabFromValue,
  tabOf,
  toComparison,
  toCursor,
  toList,
  toTab,
  toVersion,
} from './history-search.ts';

// E18-S11: what the address of a document holds, how it is read, and how each move of the history changes it.

const read = (input: Record<string, unknown>): DocumentSearch => documentSearchSchema.parse(input);

test('an address with nothing in it is the editor', () => {
  expect(read({})).toEqual({});
  expect(tabOf(read({}))).toBe('editor');
});

test.each([
  ['the history tab', { tab: 'history' }, { tab: 'history' }],
  ['a version', { view: 12 }, { view: 12 }],
  ['the comparison on a pair', { compare: true, from: 3, to: 4 }, { compare: true, from: 3, to: 4 }],
  ['a page of the list', { cursor: 'abc' }, { cursor: 'abc' }],
])('%s is read as it is', (_what, input, expected) => {
  expect(read(input)).toEqual(expected);
});

test.each([
  ['a tab that is not one', { tab: 'editor' }],
  ['a version that is text', { view: 'abc' }],
  ['a version that is zero', { view: 0 }],
  ['a version that is negative', { view: -3 }],
  ['a version that is not whole', { view: 1.5 }],
  ['a version that is an object', { view: { id: 1 } }],
  ['a comparison that is not true', { compare: 'yes' }],
  ['a from that is text', { from: 'abc' }],
  ['a to that is zero', { to: 0 }],
  ['an empty cursor', { cursor: '' }],
  ['a cursor that is too long', { cursor: 'x'.repeat(1025) }],
  ['a cursor that is a number', { cursor: 5 }],
])('%s is dropped, and the rest of the address is read', (_what, input) => {
  expect(read({ ...input, tab: 'history' })).toEqual({ tab: 'history' });
});

test('a cursor of the longest length the endpoint takes is kept', () => {
  expect(read({ cursor: 'x'.repeat(1024) }).cursor).toHaveLength(1024);
});

test.each([
  ['history', 'history'],
  ['editor', 'editor'],
  ['anything else', 'editor'],
])('the Radix value %s is the tab %s', (value, tab) => {
  expect(tabFromValue(value === 'anything else' ? 'overrides' : value)).toBe(tab);
});

test('the tab of an address is the history only when it says so', () => {
  expect(tabOf(read({ tab: 'history' }))).toBe('history');
});

test.each([
  ['nothing', {}, { type: 'none' }],
  ['a list on a page', { tab: 'history', cursor: 'c' }, { type: 'none' }],
  ['a version', { view: 4 }, { type: 'view', versionId: 4 }],
  ['a comparison with no pair', { compare: true }, { type: 'compare', pair: undefined }],
  ['a comparison on a pair', { compare: true, from: 3, to: 4 }, { type: 'compare', pair: { from: 3, to: 4 } }],
  ['a comparison with half a pair', { compare: true, from: 3 }, { type: 'compare', pair: undefined }],
  ['a comparison with the other half', { compare: true, to: 4 }, { type: 'compare', pair: undefined }],
  ['a comparison with an invalid half', { compare: true, from: 'abc', to: 4 }, { type: 'compare', pair: undefined }],
  ['a pair with no comparison', { from: 3, to: 4 }, { type: 'none' }],
  ['a version and a comparison', { view: 4, compare: true, from: 1, to: 2 }, { type: 'view', versionId: 4 }],
])('%s is the panel %j', (_what, input, panel) => {
  expect(panelOf(read(input))).toEqual(panel);
});

test('a tab changes the whole address: the history starts clean and the editor has nothing of the history', () => {
  const before = read({ tab: 'history', view: 4, cursor: 'c' });
  expect(toTab('history')(before)).toEqual({ tab: 'history' });
  expect(toTab('editor')(before)).toEqual({});
});

test('opening a version closes the comparison and keeps the page of the list', () => {
  const before = read({ tab: 'history', compare: true, from: 1, to: 2, cursor: 'c' });
  expect(toVersion(9)(before)).toEqual({ tab: 'history', view: 9, cursor: 'c' });
});

test('opening the comparison closes the version and keeps the page of the list, on a pair or on the default one', () => {
  const before = read({ tab: 'history', view: 9, cursor: 'c' });
  expect(toComparison()(before)).toEqual({ tab: 'history', compare: true, cursor: 'c' });
  expect(toComparison({ from: 1, to: 2 })(before)).toEqual({
    tab: 'history',
    compare: true,
    from: 1,
    to: 2,
    cursor: 'c',
  });
});

test('closing a panel leaves the list on its page, and a page change leaves the panel as it is', () => {
  const before = read({ tab: 'history', view: 9, cursor: 'c' });
  expect(toList(before)).toEqual({ tab: 'history', cursor: 'c' });
  expect(toCursor('d')(before)).toEqual({ tab: 'history', view: 9, cursor: 'd' });
  expect(toCursor(undefined)(before)).toEqual({ tab: 'history', view: 9, cursor: undefined });
});
