// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ALL, enabledOf, enabledValue, filterKey, isFiltered, queryOf } from './repository-filters.ts';

// E18-S10: what the Repositories screen filters by, and how a search text becomes the `q` of the endpoint.

test.each([
  ['a name', 'acme/widgets', 'acme/widgets'],
  ['a name with blanks around it', '  widgets \t', 'widgets'],
  ['a text of exactly the longest full name the endpoint takes', 'a'.repeat(140), 'a'.repeat(140)],
])('%s is a search as it is, trimmed', (_what, text, expected) => {
  expect(queryOf(text)).toBe(expected);
});

test.each([
  ['nothing', ''],
  ['blanks', ' \t\n '],
  ['a text one character longer than the endpoint takes', 'a'.repeat(141)],
  ['a text with a NUL', 'wid\0gets'],
  ['a text with a lone surrogate', 'wid\uD800gets'],
])('%s is no search: nothing is sent', (_what, text) => {
  expect(queryOf(text)).toBeUndefined();
});

test.each([
  ['nothing', { q: undefined, enabled: undefined }, false],
  ['a search', { q: 'widgets', enabled: undefined }, true],
  ['the enabled repositories', { q: undefined, enabled: true }, true],
  [
    'the disabled repositories, which is a filter even though the value is false',
    { q: undefined, enabled: false },
    true,
  ],
  ['both', { q: 'widgets', enabled: false }, true],
])('%s: the list is narrowed: %s', (_what, filters, narrowed) => {
  expect(isFiltered(filters)).toBe(narrowed);
});

test('the key is the same for the same filters and different for any other, and false is not the absence of a filter', () => {
  const keys = [
    filterKey({ q: undefined, enabled: undefined }),
    filterKey({ q: 'widgets', enabled: undefined }),
    filterKey({ q: undefined, enabled: true }),
    filterKey({ q: undefined, enabled: false }),
    filterKey({ q: 'widgets', enabled: false }),
  ];
  expect(new Set(keys).size).toBe(keys.length);
  expect(filterKey({ q: 'widgets', enabled: true })).toBe(filterKey({ q: 'widgets', enabled: true }));
});

test.each([
  ['true', true],
  ['false', false],
  [ALL, undefined],
  ['maybe', undefined],
])('the choice %j is the filter %s', (value, expected) => {
  expect(enabledOf(value)).toBe(expected);
});

test.each([
  [true, 'true'],
  [false, 'false'],
  [undefined, ALL],
])('the filter %s is the choice %j, and the choice reads back as the filter', (enabled, value) => {
  expect(enabledValue(enabled)).toBe(value);
  expect(enabledOf(enabledValue(enabled))).toBe(enabled);
});
