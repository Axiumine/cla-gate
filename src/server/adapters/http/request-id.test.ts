// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { generateRequestId, mintRequestId } from './request-id.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test.each([['trace-1234'], ['0a1b2c3d4e5f.6789_ABC-def'], ['a'.repeat(64)], ['8f14e45f-ceea-4f3d-9b6b-1d8a9c0e4a77']])(
  'a well formed id %j from the caller is kept',
  (id) => {
    expect(generateRequestId({ headers: { 'x-request-id': id } })).toBe(id);
  },
);

test.each([
  ['missing', {}],
  ['too short', { 'x-request-id': 'abc' }],
  ['too long', { 'x-request-id': 'a'.repeat(65) }],
  ['with spaces', { 'x-request-id': 'forged line text' }],
  ['with a quote', { 'x-request-id': 'abcdefgh"}{' }],
  ['repeated', { 'x-request-id': ['abcdefgh', 'ijklmnop'] }],
])('an id that is %s is replaced by a fresh UUID', (_label, headers) => {
  const id = generateRequestId({ headers });
  expect(id).toMatch(UUID);
  expect(generateRequestId({ headers })).not.toBe(id);
});

test('an id is minted by mintRequestId whatever the request carries: a UUID, a new one each time', () => {
  const id = mintRequestId();
  expect(id).toMatch(UUID);
  expect(mintRequestId()).not.toBe(id);
});
