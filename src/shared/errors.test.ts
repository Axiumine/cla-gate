// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from './errors.ts';

test('an error body needs a code, a message and the request id', () => {
  const body = { error: { code: 'not_found', message: 'Not Found', requestId: 'req-1' } };
  expect(errorResponseSchema.parse(body)).toEqual(body);
});

test.each([
  ['no request id', { error: { code: 'x', message: 'y' } }],
  ['an empty code', { error: { code: '', message: 'y', requestId: 'r' } }],
  ['an empty message', { error: { code: 'x', message: '', requestId: 'r' } }],
  ['no error object', { code: 'x' }],
])('an error body with %s is rejected', (_name, body) => {
  expect(errorResponseSchema.safeParse(body).success).toBe(false);
});
