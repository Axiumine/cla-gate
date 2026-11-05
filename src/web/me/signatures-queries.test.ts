// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ApiError, ContractError, NetworkError } from '../api/index.ts';
import { testClient } from '../api/test-support.ts';
import { isRefusedCursor, MY_SIGNATURES_PAGE_SIZE, mySignaturesQueryOptions } from './signatures-queries.ts';

// E18-S03: the query of the screen, and which failure is a cursor the server refused.

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

test('a 400 is a cursor the server refused, and nothing else is', () => {
  const failure = (status: number) => new ApiError({ status, code: 'bad_request', requestId: 'req-00000001' });
  expect(isRefusedCursor(failure(400))).toBe(true);
  expect(isRefusedCursor(failure(401))).toBe(false);
  expect(isRefusedCursor(failure(404))).toBe(false);
  expect(isRefusedCursor(failure(429))).toBe(false);
  expect(isRefusedCursor(failure(500))).toBe(false);
  expect(isRefusedCursor(new NetworkError(new TypeError('offline')))).toBe(false);
  expect(isRefusedCursor(new ContractError('GET /api/me/signatures', 'response', []))).toBe(false);
  expect(isRefusedCursor(null)).toBe(false);
  expect(isRefusedCursor(undefined)).toBe(false);
});
