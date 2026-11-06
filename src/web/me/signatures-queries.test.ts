// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { testClient } from '../api/test-support.ts';
import { MY_SIGNATURES_PAGE_SIZE, mySignaturesQueryOptions } from './signatures-queries.ts';

// E18-S03: the query of the screen.

test('a page holds 25 signatures', () => {
  expect(MY_SIGNATURES_PAGE_SIZE).toBe(25);
});

test('the pages sit in the cache under their cursor, the first one under null, and the list is asked for on every visit', () => {
  const { client } = testClient();
  const first = mySignaturesQueryOptions(client, undefined);
  const later = mySignaturesQueryOptions(client, 'c2');
  expect(first.queryKey).toEqual(['me', 'signatures', null]);
  expect(later.queryKey).toEqual(['me', 'signatures', 'c2']);
  expect(first.staleTime).toBe(0);
});
