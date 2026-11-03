// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ApiError, NetworkError } from './errors.ts';
import { answer, asApiError, asNetworkError, fakeCsrf, rejection, thrown } from './test-support.ts';

// The helpers of the client tests answer for themselves: a helper that quietly accepted the wrong thing would make the
// tests built on it prove nothing.

test('asApiError and asNetworkError return the error they are given, and fail the test for anything else', () => {
  const api = new ApiError({ status: 500, code: 'x' });
  const network = new NetworkError(new TypeError('x'));
  expect(asApiError(api)).toBe(api);
  expect(asNetworkError(network)).toBe(network);
  expect(() => asApiError(network)).toThrow('expected an ApiError');
  expect(() => asApiError(undefined)).toThrow('expected an ApiError');
  expect(() => asNetworkError(api)).toThrow('expected a NetworkError');
});

test('thrown gives what the function throws and undefined when it returns', () => {
  const failure = new Error('x');
  expect(
    thrown(() => {
      throw failure;
    }),
  ).toBe(failure);
  expect(thrown(() => 1)).toBeUndefined();
});

test('rejection gives what the promise rejects with and undefined when it resolves', async () => {
  const failure = new Error('x');
  expect(await rejection(Promise.reject(failure))).toBe(failure);
  expect(await rejection(Promise.resolve(1))).toBeUndefined();
});

test('answer with no response at all is a connection that fails, and it still records the request', async () => {
  const seen = answer('/api/nothing');
  await expect(fetch('/api/nothing', { method: 'POST', body: 'x' })).rejects.toBeInstanceOf(TypeError);
  expect(seen).toMatchObject([{ method: 'POST', text: 'x' }]);
});

test('answer gives its responses in turn and the last one again', async () => {
  answer('/api/turns', new Response('one'), new Response('two'));
  const bodies: string[] = [];
  for (let call = 0; call < 3; call += 1) {
    bodies.push(await (await fetch('/api/turns')).text());
  }
  expect(bodies).toEqual(['one', 'two', 'two']);
});

test('fakeCsrf holds its token, keeps it on refresh unless told another (even none), and counts the refreshes', async () => {
  const same = fakeCsrf('a');
  expect(same.current()).toBe('a');
  expect(await same.refresh()).toBe('a');
  const changed = fakeCsrf('a', 'b');
  expect(await changed.refresh()).toBe('b');
  expect(changed.current()).toBe('b');
  const gone = fakeCsrf('a', undefined);
  expect(await gone.refresh()).toBeUndefined();
  expect(gone.current()).toBeUndefined();
  gone.set('c');
  expect(gone.current()).toBe('c');
  expect([same.refreshes(), changed.refreshes(), gone.refreshes()]).toEqual([1, 1, 1]);
});
