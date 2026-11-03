// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { CLIENT_ERROR_CODES, DOMAIN_ERROR_CODES, ERROR_CODES, isErrorCode, STATUS_ERROR_CODES } from './error-codes.ts';

// E17-S07: the list of error codes the web app has messages for.

/** Lower-case snake_case: words of letters and digits joined by single underscores, the first one starting with a letter. */
function isSnakeCase(code: string): boolean {
  return /^[a-z]/.test(code) && code.split('_').every((word) => /^[a-z0-9]+$/.test(word));
}

test.each(ERROR_CODES)('the code %s is lower-case snake_case, like every code of the error body', (code) => {
  expect(isSnakeCase(code)).toBe(true);
});

test('the list is the status codes, the domain codes and the client codes, each once', () => {
  expect(ERROR_CODES).toEqual([...Object.values(STATUS_ERROR_CODES), ...DOMAIN_ERROR_CODES, ...CLIENT_ERROR_CODES]);
  expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
});

test.each(Object.entries(STATUS_ERROR_CODES))('status %s is named %s', (status, code) => {
  expect(Number(status)).toBeGreaterThanOrEqual(400);
  expect(isErrorCode(code)).toBe(true);
});

test.each(ERROR_CODES)('%s is a known code', (code) => {
  expect(isErrorCode(code)).toBe(true);
});

test.each(['', 'tenant_denied', 'NOT_FOUND', '__proto__', 'constructor', 'toString', 'not_found '])(
  '%j is not a known code, and neither is anything that an object would answer for',
  (code) => {
    expect(isErrorCode(code)).toBe(false);
  },
);
