// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { verifiedEmailsSchema } from './verified-email.ts';

const ADDRESS = { email: 'person@example.test', primary: true };

test('an address with its primary flag is accepted and kept as given', () => {
  const list = [ADDRESS, { email: 'Mixed.Case+tag@Example.test', primary: false }];
  expect(verifiedEmailsSchema.parse(list)).toEqual(list);
});

test.each([
  ['an empty address', { email: '', primary: true }],
  ['an address of 321 characters', { email: 'a'.repeat(321), primary: true }],
  ['a missing primary flag', { email: 'person@example.test' }],
  ['a primary flag that is text', { email: 'person@example.test', primary: 'yes' }],
  ['an extra key', { ...ADDRESS, name: 'Person' }],
  ['a bare string', 'person@example.test'],
  ['null', null],
])('%s is refused', (_label, value) => {
  expect(verifiedEmailsSchema.safeParse([value]).success).toBe(false);
});

test('an address of 320 characters is accepted', () => {
  expect(verifiedEmailsSchema.safeParse([{ email: 'a'.repeat(320), primary: false }]).success).toBe(true);
});

test('a list holds at most 20 addresses, and is a list', () => {
  const list = (count: number) => Array.from({ length: count }, () => ADDRESS);
  expect(verifiedEmailsSchema.safeParse(list(0)).success).toBe(true);
  expect(verifiedEmailsSchema.safeParse(list(20)).success).toBe(true);
  expect(verifiedEmailsSchema.safeParse(list(21)).success).toBe(false);
  expect(verifiedEmailsSchema.safeParse({ ...ADDRESS }).success).toBe(false);
});
