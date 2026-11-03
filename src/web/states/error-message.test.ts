// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, expectTypeOf, test } from 'vitest';
import { ERROR_CODES, type ErrorCode } from '../../shared/error-codes.ts';
import { ApiError, ContractError, NetworkError } from '../api/errors.ts';
import { createTranslator, type MessageKey, messages } from '../i18n/index.ts';
import { errorMessage } from './error-message.ts';

// E17-S07: errorMessage maps an error to an entry of the catalog, and to nothing else.

const t = createTranslator(messages, 'en');
const apiError = (code: string, status = 400) => new ApiError({ status, code, requestId: 'req-1' });

test.each(ERROR_CODES)(
  'the code %s has a message of its own under errors.%s, and an ApiError with it shows that message',
  (code) => {
    const key = `errors.${code}` as const;
    expect(Object.hasOwn(messages, key), `${key} is in the catalog`).toBe(true);
    expect(errorMessage(apiError(code), t)).toBe(t(key));
    expect(errorMessage(apiError(code), t)).not.toBe(t('errors.unknown'));
  },
);

test('every code of src/shared has a catalog key, which the compiler also checks', () => {
  type Missing = Exclude<`errors.${ErrorCode}`, MessageKey>;
  expectTypeOf<Missing>().toBeNever();
  expect(ERROR_CODES.length).toBeGreaterThan(0);
});

test('every errors.* entry of the catalog is for a code the app knows, or is the fallback', () => {
  const known = new Set<string>([...ERROR_CODES, 'unknown']);
  const orphans = Object.keys(messages)
    .filter((key) => key.startsWith('errors.'))
    .filter((key) => !known.has(key.slice('errors.'.length)));
  expect(orphans).toEqual([]);
});

test.each(['tenant_denied', '', 'Forbidden', '__proto__', 'constructor', 'hasOwnProperty', 'errors.network'])(
  'an ApiError with the code %j that the app has no message for gets errors.unknown',
  (code) => {
    expect(errorMessage(apiError(code), t)).toBe(t('errors.unknown'));
  },
);

test('a network failure gets errors.network and a contract failure errors.contract, whatever else they carry', () => {
  expect(errorMessage(new NetworkError(new TypeError('Failed to fetch')), t)).toBe(t('errors.network'));
  expect(errorMessage(new ContractError('GET /api/x', 'response', ['items.0.name']), t)).toBe(t('errors.contract'));
});

test.each([
  ['an Error', new Error('boom')],
  ['a string', 'boom'],
  ['null', null],
  ['undefined', undefined],
  ['an object with a code', { code: 'not_found' }],
])('%s is not an ApiError and gets errors.unknown', (_what, error) => {
  expect(errorMessage(error, t)).toBe(t('errors.unknown'));
});

test('the words never come from the error: its message, its status and a hostile code stay out', () => {
  const error = new ApiError({ status: 500, code: 'internal_server_error', requestId: 'req-1' });
  Object.defineProperty(error, 'message', { value: 'SQL: select * from secrets' });
  expect(errorMessage(error, t)).toBe(t('errors.internal_server_error'));
  expect(errorMessage(error, t)).not.toContain('SQL');
  expect(errorMessage(apiError('<img src=x onerror=alert(1)>'), t)).toBe(t('errors.unknown'));
});
