// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from './cursor.ts';
import { AppError } from './errors.ts';

const position = z.tuple([z.string(), z.int()]);

const refusal = (cursor: string): unknown => {
  try {
    return decodeCursor(position, cursor);
  } catch (error) {
    return error;
  }
};

test.each([
  ['a name and an id', ['Individual CLA', 7]],
  ['a name with quotes, a backslash and a line break', ['a"b\\c\nd', 1]],
  ['a name outside the first plane', ['\u{1F600}', 2]],
  ['an empty name', ['', 3]],
])('the cursor of %s reads back as it was made', (_label, value) => {
  expect(decodeCursor(position, encodeCursor(value))).toEqual(value);
});

test('a cursor is the base64url of the JSON of the position: no padding, no plus, no slash', () => {
  const cursor = encodeCursor(['??>>', 1]);
  expect(cursor).toBe(Buffer.from('["??>>",1]', 'utf8').toString('base64url'));
  expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
});

test.each([
  ['padding that was added', `${encodeCursor(['a', 1])}=`],
  ['a character outside the alphabet', `${encodeCursor(['a', 1])}!`],
  ['standard base64 where base64url is meant', Buffer.from('["??>>",1]', 'utf8').toString('base64')],
  ['text that is not JSON', Buffer.from('["a",', 'utf8').toString('base64url')],
  ['JSON of the wrong shape', encodeCursor({ name: 'a' })],
  ['a position of the wrong types', encodeCursor([1, 'a'])],
  ['nothing', ''],
])('%s is a 400 bad_request', (_label, cursor) => {
  const error = refusal(cursor);
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ status: 400, code: 'bad_request' });
});
