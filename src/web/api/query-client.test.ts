// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { MutationObserver, QueryObserver } from '@tanstack/react-query';
import { afterEach, expect, test, vi } from 'vitest';
import { ApiError, ContractError, NetworkError } from './errors.ts';
import { createQueryClient, GC_TIME_MS, MAX_QUERY_RETRIES, STALE_TIME_MS, shouldRetryQuery } from './query-client.ts';

afterEach(() => {
  vi.useRealTimers();
});

const apiError = (status: number) => new ApiError({ status, code: 'some_code' });

test('the defaults are 30 seconds fresh, 5 minutes kept, and no mutation retry', () => {
  const defaults = createQueryClient().getDefaultOptions();
  expect(STALE_TIME_MS).toBe(30 * 1000);
  expect(GC_TIME_MS).toBe(5 * 60 * 1000);
  expect(defaults.queries).toMatchObject({ staleTime: 30_000, gcTime: 300_000, retry: shouldRetryQuery });
  expect(defaults.mutations).toEqual({ retry: false });
});

test.each([
  ['a 400', 0, apiError(400)],
  ['a 401', 0, apiError(401)],
  ['a 404 on a later try', 1, apiError(404)],
  ['a 429', 0, apiError(429)],
  ['a 499', 0, apiError(499)],
])('%s is never retried (failure %i)', (_what, failureCount, error) => {
  expect(shouldRetryQuery(failureCount, error)).toBe(false);
});

test.each([
  ['a 500, first failure', 0, apiError(500)],
  ['a 503, second failure', 1, apiError(503)],
  ['a network error, first failure', 0, new NetworkError(new TypeError('x'))],
  ['a contract error, second failure', 1, new ContractError('GET /api/x', 'response', [])],
  ['an error nobody classified', 0, new Error('x')],
  ['something that is not an error', 1, 'text'],
])('%s is retried', (_what, failureCount, error) => {
  expect(shouldRetryQuery(failureCount, error)).toBe(true);
});

test.each([
  ['a 500', apiError(500)],
  ['a network error', new NetworkError(new TypeError('x'))],
])('%s stops being retried at the third failure: two retries at most', (_what, error) => {
  expect(MAX_QUERY_RETRIES).toBe(2);
  expect(shouldRetryQuery(MAX_QUERY_RETRIES, error)).toBe(false);
  expect(shouldRetryQuery(MAX_QUERY_RETRIES + 1, error)).toBe(false);
});

/** Runs a query that always fails with `error` until it settles, and returns how many times its function was called. */
async function attempts(error: Error): Promise<number> {
  vi.useFakeTimers();
  const client = createQueryClient();
  const queryFn = vi.fn(() => Promise.reject(error));
  const observer = new QueryObserver(client, { queryKey: ['probe'], queryFn });
  const unsubscribe = observer.subscribe(() => undefined);
  await vi.advanceTimersByTimeAsync(60_000);
  unsubscribe();
  client.clear();
  return queryFn.mock.calls.length;
}

test('a query that fails with a client error runs once', async () => {
  expect(await attempts(apiError(404))).toBe(1);
});

test('a query that fails with a server error runs three times: the first try and two retries', async () => {
  expect(await attempts(apiError(500))).toBe(3);
});

test('a mutation that fails runs once, whatever the error', async () => {
  const client = createQueryClient();
  const mutationFn = vi.fn(() => Promise.reject(new NetworkError(new TypeError('x'))));
  const observer = new MutationObserver(client, { mutationFn });
  await observer.mutate().catch(() => undefined);
  expect(mutationFn).toHaveBeenCalledTimes(1);
});
