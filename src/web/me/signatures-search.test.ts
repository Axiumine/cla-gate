// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { mySignaturesSearchSchema } from './signatures-search.ts';

// E18-S03: `?cursor=` is a text of the length the endpoint takes, else nothing.

test('a cursor of 1 to 1024 characters is kept as it is: it is opaque', () => {
  expect(mySignaturesSearchSchema.parse({ cursor: 'WyIyMDI2LTExLTAyVDA5OjMwOjAwLjAwMDAwMFoiLDkwMF0' })).toEqual({
    cursor: 'WyIyMDI2LTExLTAyVDA5OjMwOjAwLjAwMDAwMFoiLDkwMF0',
  });
  expect(mySignaturesSearchSchema.parse({ cursor: 'a' })).toEqual({ cursor: 'a' });
  expect(mySignaturesSearchSchema.parse({ cursor: 'a'.repeat(1024) }).cursor).toHaveLength(1024);
});

test('no cursor is the first page', () => {
  expect(mySignaturesSearchSchema.parse({})).toEqual({});
});

test.each([
  ['an empty text', ''],
  ['a text of 1025 characters', 'a'.repeat(1025)],
  ['a number', 123],
  ['a list', ['a']],
  ['an object', { a: 1 }],
  ['true', true],
  ['null', null],
])('%s is no cursor: it is dropped instead of failing the page', (_what, cursor) => {
  expect(mySignaturesSearchSchema.parse({ cursor })).toEqual({ cursor: undefined });
});

test('a key the screen does not know, such as a person, is dropped', () => {
  expect(mySignaturesSearchSchema.parse({ cursor: 'c2', userId: 2, githubId: 3 })).toEqual({ cursor: 'c2' });
});
