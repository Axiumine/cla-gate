// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { QueryClient } from '@tanstack/react-query';
import { expect, test } from 'vitest';
import { INSTALLATION_REPOSITORIES_PATH } from '../../shared/installations.ts';
import { answer, testClient } from '../api/test-support.ts';
import { REPOSITORIES_PAGE_SIZE, repositoriesKey, repositoriesQueryOptions } from './repository-queries.ts';
import { pageOf } from './test-support.ts';

// E18-S10: the queries of the screen. Their keys start with the installation, so one tenant's pages are kept and dropped together.

const NONE = { q: undefined, enabled: undefined } as const;

test('a page holds 50 repositories', () => {
  expect(REPOSITORIES_PAGE_SIZE).toBe(50);
});

test("the key of an installation's repositories is under the installation, then 'repositories'", () => {
  expect(repositoriesKey(5)).toEqual(['installation', 5, 'repositories']);
  expect(repositoriesKey(6)).toEqual(['installation', 6, 'repositories']);
});

test('a page sits in the cache under the installation, the filters and its cursor, the first page under null', () => {
  const { client } = testClient();
  const first = repositoriesQueryOptions(client, 5, { filters: NONE, cursor: undefined });
  const later = repositoriesQueryOptions(client, 5, { filters: { q: 'widgets', enabled: false }, cursor: 'c2' });
  expect(first.queryKey).toEqual(['installation', 5, 'repositories', 'list', null, null, null]);
  expect(later.queryKey).toEqual(['installation', 5, 'repositories', 'list', 'widgets', false, 'c2']);
});

test('the same filters on two installations are two entries, each under its own installation', () => {
  const { client } = testClient();
  const a = repositoriesQueryOptions(client, 5, { filters: NONE, cursor: undefined });
  const b = repositoriesQueryOptions(client, 6, { filters: NONE, cursor: undefined });
  expect(a.queryKey).not.toEqual(b.queryKey);
  expect(a.queryKey.slice(0, 3)).toEqual(repositoriesKey(5));
  expect(b.queryKey.slice(0, 3)).toEqual(repositoriesKey(6));
});

test('the list is asked for on every visit, and the page on screen stays until the next one of the same search is there', () => {
  const { client } = testClient();
  const options = repositoriesQueryOptions(client, 5, { filters: NONE, cursor: undefined });
  expect(options.staleTime).toBe(0);
  expect(typeof options.placeholderData).toBe('function');
});

test.each([
  ['no filter', NONE, undefined, { limit: '50' }],
  ['a search', { q: 'widgets', enabled: undefined }, undefined, { limit: '50', q: 'widgets' }],
  ['the enabled repositories', { q: undefined, enabled: true }, undefined, { limit: '50', enabled: 'true' }],
  [
    'the disabled repositories',
    { q: undefined, enabled: false },
    'c2',
    { limit: '50', enabled: 'false', cursor: 'c2' },
  ],
])('the request for %s sends only the parameters that are set', async (_what, filters, cursor, expected) => {
  const seen = answer(INSTALLATION_REPOSITORIES_PATH, pageOf([]));
  const { client } = testClient();
  const options = repositoriesQueryOptions(client, 5, { filters, cursor });
  await new QueryClient().query(options);
  expect(Object.fromEntries(new URL(String(seen[0]?.url)).searchParams)).toEqual(expected);
  expect(new URL(String(seen[0]?.url)).pathname).toBe('/api/installations/5/repositories');
});
