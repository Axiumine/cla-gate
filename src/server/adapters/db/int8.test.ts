// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { INT8_OID, parseInt8 } from './int8.ts';

test('INT8_OID is the Postgres oid of bigint', () => {
  expect(INT8_OID).toBe(20);
});

test.each([
  ['0', 0],
  ['42', 42],
  ['-7', -7],
  ['9007199254740991', Number.MAX_SAFE_INTEGER],
  ['-9007199254740991', Number.MIN_SAFE_INTEGER],
])('%s parses to the exact number %d', (text, expected) => {
  expect(parseInt8(text)).toBe(expected);
});

test.each([
  ['9007199254740992'],
  ['-9007199254740992'],
  ['9223372036854775807'],
  ['not a number'],
  ['1.5'],
  [''],
  // Number() accepts all of these as safe integers; a bigint column never prints like that.
  [' 42'],
  ['42 '],
  ['+5'],
  ['0x10'],
  ['1e3'],
  ['0b11'],
])('%j is refused instead of being rounded or reinterpreted', (text) => {
  expect(() => parseInt8(text)).toThrow(new RangeError('bigint value is outside the safe integer range'));
});
