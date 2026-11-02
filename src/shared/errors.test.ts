// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorDetailsSchema, errorResponseSchema } from './errors.ts';

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

test('an error body may carry details, a plain JSON object, and keeps them as they are', () => {
  const details = { limit: 5, fields: ['name', 'email'], nested: { ok: false, none: null } };
  const body = { error: { code: 'too_many', message: 'Too Many Requests', requestId: 'req-1', details } };
  expect(errorResponseSchema.parse(body)).toEqual(body);
});

test('an error body without details has no details key', () => {
  const body = { error: { code: 'not_found', message: 'Not Found', requestId: 'req-1' } };
  expect(Object.keys(errorResponseSchema.parse(body).error)).toEqual(['code', 'message', 'requestId']);
});

test.each([
  ['a string', 'text'],
  ['an array', ['a']],
  ['null', null],
  ['a number', 3],
  ['an object holding undefined', { a: undefined }],
  ['an object holding a function', { a: () => 1 }],
  ['an object holding a Date', { a: new Date(0) }],
])('details that are %s are rejected', (_name, details) => {
  expect(errorDetailsSchema.safeParse(details).success).toBe(false);
  const body = { error: { code: 'x', message: 'y', requestId: 'r', details } };
  expect(errorResponseSchema.safeParse(body).success).toBe(false);
});
