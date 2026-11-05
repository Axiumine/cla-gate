// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { testClient } from '../api/test-support.ts';
import { installationKey } from '../installations/installation-queries.ts';
import { allowlistKey, entriesQueryOptions } from './allowlist-queries.ts';

// E18-S06: the keys of the allowlist queries: every one starts with its tenant, so the entries of a tenant are kept and dropped as a unit.

const { client } = testClient();

test('every key of the allowlist of a tenant starts with the key of the tenant and "allowlist"', () => {
  expect(allowlistKey(5)).toEqual([...installationKey(5), 'allowlist']);
  expect(allowlistKey(5)).not.toEqual(allowlistKey(6));
});

test('the whole installation and each repository have a key of their own, under the tenant of the address', () => {
  expect(entriesQueryOptions(client, 5, undefined).queryKey).toEqual(['installation', 5, 'allowlist', 'installation']);
  expect(entriesQueryOptions(client, 5, 3).queryKey).toEqual(['installation', 5, 'allowlist', 3]);
  expect(entriesQueryOptions(client, 5, 3).queryKey).not.toEqual(entriesQueryOptions(client, 6, 3).queryKey);
});

test('the queries use no placeholder data from another key, so that another scope is loading and never shows the rows of this one', () => {
  expect('placeholderData' in entriesQueryOptions(client, 5, undefined)).toBe(false);
  expect('placeholderData' in entriesQueryOptions(client, 5, 3)).toBe(false);
});

test('the next page is the cursor the server answered with, and the last page has none', () => {
  const { getNextPageParam } = entriesQueryOptions(client, 5, undefined);
  const page = { own: [], inherited: [] };
  expect(getNextPageParam({ ...page, nextCursor: 'next' }, [], undefined, [])).toBe('next');
  expect(getNextPageParam({ ...page, nextCursor: null }, [], undefined, [])).toBeUndefined();
});
