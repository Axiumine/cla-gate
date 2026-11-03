// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import { ApiError, ContractError, issuePaths, NetworkError } from './errors.ts';

function failure(schema: z.ZodType, value: unknown): z.ZodError {
  const result = schema.safeParse(value);
  if (result.success) {
    throw new Error('the value was expected to fail');
  }
  return result.error;
}

test('an ApiError carries the status, the code, the request id and the wait, and its message has only the status', () => {
  const error = new ApiError({
    status: 429,
    code: 'too_many_requests',
    requestId: 'req-12345678',
    retryAfterSeconds: 7,
  });
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe('ApiError');
  expect(error).toMatchObject({
    status: 429,
    code: 'too_many_requests',
    requestId: 'req-12345678',
    retryAfterSeconds: 7,
  });
  expect(error.message).toBe('The request failed with status 429');
});

test('an ApiError without a request id or a wait has both undefined', () => {
  const error = new ApiError({ status: 502, code: 'unexpected_response' });
  expect(error.requestId).toBeUndefined();
  expect(error.retryAfterSeconds).toBeUndefined();
});

test('issuePaths gives the path of every issue, with array indexes, and $ for the root', () => {
  const schema = z.object({ items: z.array(z.object({ name: z.string() })), count: z.number() });
  expect(issuePaths(failure(schema, { items: [{ name: 'a' }, { name: 5 }], count: 'x' }))).toEqual([
    'items.1.name',
    'count',
  ]);
  expect(issuePaths(failure(z.string(), 7))).toEqual(['$']);
});

test('issuePaths never repeats a value of the data', () => {
  const leak = 'ghu_notARealToken1234567890';
  const paths = issuePaths(failure(z.object({ id: z.number() }), { id: leak }));
  expect(paths).toEqual(['id']);
  expect(JSON.stringify(paths)).not.toContain(leak);
});

test('issuePaths cuts a long path and a long list: a hostile payload cannot make the error large', () => {
  const longKey = 'k'.repeat(500);
  expect(issuePaths(failure(z.record(z.string(), z.number()), { [longKey]: 'x' }))[0]).toHaveLength(80);
  const many = Object.fromEntries(Array.from({ length: 200 }, (_unused, index) => [`key${index}`, 'x']));
  expect(issuePaths(failure(z.record(z.string(), z.number()), many))).toHaveLength(20);
});

test('a ContractError names the route template, the part and the paths', () => {
  const error = new ContractError('GET /api/things/:thingId', 'response', ['id', 'items.0']);
  expect(error.name).toBe('ContractError');
  expect(error).toMatchObject({ routeName: 'GET /api/things/:thingId', part: 'response', paths: ['id', 'items.0'] });
  expect(error.message).toBe('The response of GET /api/things/:thingId does not match its contract at id, items.0');
});

test('a ContractError without paths says no path', () => {
  expect(new ContractError('GET /api/x', 'params', []).message).toBe(
    'The params of GET /api/x does not match its contract',
  );
});

test('a NetworkError keeps the original failure as its cause and puts none of it in the message', () => {
  const cause = new TypeError('Failed to fetch https://example.test/api?token=abc');
  const error = new NetworkError(cause);
  expect(error.name).toBe('NetworkError');
  expect(error.cause).toBe(cause);
  expect(error.message).toBe('The request could not reach the server');
});
