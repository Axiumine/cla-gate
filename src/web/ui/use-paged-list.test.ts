// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ApiError, ContractError, NetworkError } from '../api/index.ts';
import { isRefusedCursor } from './use-paged-list.ts';

// E18-S03: which failure of a paged list is a cursor the server refused.

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
