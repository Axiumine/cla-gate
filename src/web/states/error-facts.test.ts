// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ApiError, ContractError, NetworkError } from '../api/errors.ts';
import { isForbidden, visibleRequestId, waitSeconds } from './error-facts.ts';

// E17-S07: the three facts the error screens read out of an error.

const api = (init: Partial<ConstructorParameters<typeof ApiError>[0]> = {}) =>
  new ApiError({ status: 500, code: 'x', ...init });

test.each(['req-00000001', '0b0c9b0e-1f0e-4c2a-9a0e-3a5a7f6a0f11', 'a', 'A.b_c-d', 'x'.repeat(64)])(
  'the request id %s of an ApiError is shown',
  (requestId) => {
    expect(visibleRequestId(api({ requestId }))).toBe(requestId);
  },
);

test.each([
  ['empty', ''],
  ['65 characters', 'x'.repeat(65)],
  ['a space', 'req 1'],
  ['markup', '<b>req</b>'],
  ['a right-to-left override', 'req\u202E1'],
  ['a newline', 'req\n1'],
])('a request id with %s is not shown', (_what, requestId) => {
  expect(visibleRequestId(api({ requestId }))).toBeUndefined();
});

test('an ApiError without a request id, and anything that is not an ApiError, has none to show', () => {
  expect(visibleRequestId(api())).toBeUndefined();
  expect(visibleRequestId(new Error('req-00000001'))).toBeUndefined();
  expect(visibleRequestId({ requestId: 'req-00000001' })).toBeUndefined();
  expect(visibleRequestId(new NetworkError(new Error('x')))).toBeUndefined();
  expect(visibleRequestId(undefined)).toBeUndefined();
});

test('only an ApiError with status 403 is forbidden', () => {
  expect(isForbidden(api({ status: 403, code: 'forbidden' }))).toBe(true);
  expect(isForbidden(api({ status: 403, code: 'csrf_invalid' }))).toBe(true);
  expect(isForbidden(api({ status: 401, code: 'unauthenticated' }))).toBe(false);
  expect(isForbidden(api({ status: 404 }))).toBe(false);
  expect(isForbidden({ status: 403 })).toBe(false);
  expect(isForbidden(new ContractError('GET /api/x', 'response', []))).toBe(false);
});

test('a 429 waits for the seconds it asked for, and nothing else waits', () => {
  expect(waitSeconds(api({ status: 429, retryAfterSeconds: 7 }))).toBe(7);
  expect(waitSeconds(api({ status: 429, retryAfterSeconds: 0 }))).toBe(0);
  expect(waitSeconds(api({ status: 429 }))).toBe(0);
  expect(waitSeconds(api({ status: 503, retryAfterSeconds: 7 }))).toBe(0);
  expect(waitSeconds({ status: 429, retryAfterSeconds: 7 })).toBe(0);
  expect(waitSeconds(undefined)).toBe(0);
});
