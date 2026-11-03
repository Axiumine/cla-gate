// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { ApiError } from '../api/errors.ts';
import { logCrash } from './crash-log.ts';

// E17-S07: what the boundaries write to the console: the name of the error and the request id, and nothing else.

function logged(error: unknown): unknown[][] {
  const calls: unknown[][] = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    calls.push(args);
  });
  logCrash(error);
  return calls;
}

test('an error is logged by its name alone, in one call with one argument', () => {
  expect(logged(new TypeError('the message'))).toEqual([['Unhandled TypeError']]);
});

test('an ApiError is logged with its name and its request id', () => {
  const error = new ApiError({ status: 500, code: 'internal_server_error', requestId: 'req-00000001' });
  expect(logged(error)).toEqual([['Unhandled ApiError, request req-00000001']]);
});

test('an ApiError without a request id is logged by its name', () => {
  expect(logged(new ApiError({ status: 500, code: 'internal_server_error' }))).toEqual([['Unhandled ApiError']]);
});

test('the message, the stack and the cause of the error are not in the log', () => {
  const error = new Error('SECRET message', { cause: 'SECRET cause' });
  const calls = logged(error);
  expect(JSON.stringify(calls)).not.toContain('SECRET');
  expect(JSON.stringify(calls)).not.toContain('at ');
  expect(calls[0]).toHaveLength(1);
});

test.each([
  ['a string', 'SECRET'],
  ['undefined', undefined],
  ['null', null],
  ['a plain object', { name: 'SECRET', message: 'SECRET' }],
])('%s that was thrown is logged as a generic Error, with nothing of it', (_what, thrown) => {
  const calls = logged(thrown);
  expect(calls).toEqual([['Unhandled Error']]);
});

test.each([
  ['a newline', 'Evil\nUnhandled ApiError, request x'],
  ['markup', '<img src=x>'],
  ['a long name', 'N'.repeat(65)],
  ['an empty name', ''],
])('an error named with %s is logged as a generic Error', (_what, name) => {
  const error = new Error('x');
  error.name = name;
  expect(logged(error)).toEqual([['Unhandled Error']]);
});

test("a request id that does not look like one of the server's is not logged", () => {
  const error = new ApiError({ status: 500, code: 'x', requestId: 'req\nforged line' });
  expect(logged(error)).toEqual([['Unhandled ApiError']]);
});
