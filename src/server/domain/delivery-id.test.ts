// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { deliveryIdSchema } from './delivery-id.ts';

// The key a delivery is recorded under (E06-S06): a UUID, in lower case, and nothing else.

const LOWER = '5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c';

test('a UUID is kept as it is', () => {
  expect(deliveryIdSchema.parse(LOWER)).toBe(LOWER);
});

test('a UUID in upper or mixed case becomes the one lower-case key, so one delivery never has two', () => {
  expect(deliveryIdSchema.parse(LOWER.toUpperCase())).toBe(LOWER);
  expect(deliveryIdSchema.parse('5B8F2c1e-3D4a-4F6b-9A7c-0E1d2F3a4B5c')).toBe(LOWER);
});

test('any version of UUID is a delivery id, as GitHub sends them', () => {
  expect(deliveryIdSchema.parse('00000000-0000-0000-0000-000000000000')).toBe('00000000-0000-0000-0000-000000000000');
  expect(deliveryIdSchema.parse('ffffffff-ffff-1fff-8fff-ffffffffffff')).toBe('ffffffff-ffff-1fff-8fff-ffffffffffff');
});

test.each([
  ['an empty string', ''],
  ['text', 'not-a-uuid'],
  ['a UUID without its hyphens', LOWER.replaceAll('-', '')],
  ['a UUID with a trailing space', `${LOWER} `],
  ['a UUID with a leading newline', `\n${LOWER}`],
  ['a UUID with a suffix', `${LOWER}-1`],
  ['a UUID in braces', `{${LOWER}}`],
  ['a UUID with a non-hex digit', LOWER.replace('5b8f', '5bgf')],
  ['a clause that closes a quote', `${LOWER}' or '1'='1`],
  ['a statement', `${LOWER}'; drop table webhook_deliveries; --`],
  ['a NUL byte', `${LOWER}\0`],
  ['a number', 7],
  ['a list of UUIDs', [LOWER]],
  ['an object', { id: LOWER }],
  ['null', null],
  ['undefined', undefined],
])('%s is not a delivery id', (_label, value) => {
  expect(deliveryIdSchema.safeParse(value).success).toBe(false);
});

test('a delivery id is at most 36 characters, inside the 1 to 128 that the column allows', () => {
  expect(deliveryIdSchema.parse(LOWER)).toHaveLength(36);
});
