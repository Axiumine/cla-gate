// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { encodeCursor } from './cursor.ts';
import { AppError } from './errors.ts';
import { readRepositoryCursor, repositoryCursor } from './repository-cursor.ts';

const refusal = (cursor: string): unknown => {
  try {
    return readRepositoryCursor(cursor);
  } catch (error) {
    return error;
  }
};

test.each([
  [{ fullName: 'acme/api', id: 7 }],
  [{ fullName: 'acme/100%_\\"sure"', id: 1 }],
  [{ fullName: 'acme/\u{1F600}', id: 9_007_199_254_740_991 }],
  [{ fullName: 'a'.repeat(256), id: 2 }],
])('the cursor of %j reads back as the position it was made from', (position) => {
  expect(readRepositoryCursor(repositoryCursor(position))).toEqual(position);
});

test('a cursor is the base64url of the pair [full name, id]', () => {
  expect(repositoryCursor({ fullName: 'acme/api', id: 7 })).toBe(Buffer.from('["acme/api",7]').toString('base64url'));
});

test.each([
  ['text that is not base64url', '%%%'],
  ['padding', `${repositoryCursor({ fullName: 'a', id: 1 })}=`],
  ['something that is not JSON', Buffer.from('nope').toString('base64url')],
  ['a pair with the id missing', encodeCursor(['acme/api'])],
  ['a triple', encodeCursor(['acme/api', 1, 2])],
  ['an object', encodeCursor({ fullName: 'acme/api', id: 1 })],
  ['an id of 0', encodeCursor(['acme/api', 0])],
  ['an id with a fraction', encodeCursor(['acme/api', 1.5])],
  ['an id as text', encodeCursor(['acme/api', '1'])],
  ['a name that is not text', encodeCursor([5, 1])],
  ['a name with a NUL', encodeCursor(['acme/\0', 1])],
  ['a name with a lone surrogate', Buffer.from('["\\ud800",1]').toString('base64url')],
  ['a name of 257 characters', encodeCursor(['a'.repeat(257), 1])],
])('a cursor that is %s is a 400 bad_request', (_label, cursor) => {
  const error = refusal(cursor);
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ status: 400, code: 'bad_request' });
});
