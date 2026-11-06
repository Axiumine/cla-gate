// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { testClient } from '../api/test-support.ts';
import { SIGNATURES_PAGE_SIZE, signaturesKey, signaturesQueryOptions } from './signature-queries.ts';

// E18-S07: the query of the screen. Its key starts with the installation, so one tenant's pages are kept and dropped together.

const NONE = { q: undefined, state: undefined, document: undefined } as const;

test('a page holds 50 signatures', () => {
  expect(SIGNATURES_PAGE_SIZE).toBe(50);
});

test("the key of an installation's signatures is under the installation, then 'signatures'", () => {
  expect(signaturesKey(5)).toEqual(['installation', 5, 'signatures']);
  expect(signaturesKey(6)).toEqual(['installation', 6, 'signatures']);
});

test('a page sits in the cache under the installation, the filters and its cursor, the first page under null', () => {
  const { client } = testClient();
  const first = signaturesQueryOptions(client, 5, { filters: NONE, cursor: undefined });
  const later = signaturesQueryOptions(client, 5, {
    filters: { q: 'octocat', state: 'revoked', document: 11 },
    cursor: 'c2',
  });
  expect(first.queryKey).toEqual(['installation', 5, 'signatures', null, null, null, null]);
  expect(later.queryKey).toEqual(['installation', 5, 'signatures', 'octocat', 'revoked', 11, 'c2']);
});

test('the same filters on two installations are two entries, each under its own installation', () => {
  const { client } = testClient();
  const a = signaturesQueryOptions(client, 5, { filters: NONE, cursor: undefined });
  const b = signaturesQueryOptions(client, 6, { filters: NONE, cursor: undefined });
  expect(a.queryKey).not.toEqual(b.queryKey);
  expect(a.queryKey.slice(0, 3)).toEqual(signaturesKey(5));
  expect(b.queryKey.slice(0, 3)).toEqual(signaturesKey(6));
});

test('a search for digits and a search for the same digits as a document are not the same entry', () => {
  const { client } = testClient();
  const search = signaturesQueryOptions(client, 5, { filters: { ...NONE, q: '11' }, cursor: undefined });
  const document = signaturesQueryOptions(client, 5, { filters: { ...NONE, document: 11 }, cursor: undefined });
  expect(search.queryKey).not.toEqual(document.queryKey);
});

test('the list is asked for on every visit, and the page on screen stays until the next one of the same search is there', () => {
  const { client } = testClient();
  const options = signaturesQueryOptions(client, 5, { filters: NONE, cursor: undefined });
  expect(options.staleTime).toBe(0);
  expect(typeof options.placeholderData).toBe('function');
});
