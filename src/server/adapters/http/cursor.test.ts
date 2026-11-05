// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import { decodeCursor, encodeCursor, instantPositionSchema } from './cursor.ts';
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

const INSTANT = '2026-10-01T10:00:00.123456Z';

test.each([
  ['an instant to the microsecond in UTC and an id', [INSTANT, 7]],
  ['the first day of the year 1', ['0001-01-01T00:00:00.000000Z', 1]],
])('the position of %s is read', (_label, value) => {
  expect(decodeCursor(instantPositionSchema, encodeCursor(value))).toEqual(value);
});

test.each([
  ['an instant to the millisecond', ['2026-10-01T10:00:00.123Z', 1]],
  ['an instant with an offset', ['2026-10-01T10:00:00.123456+01:00', 1]],
  ['an instant in the year 0', ['0000-12-31T00:00:00.000000Z', 1]],
  ['a calendar day that does not exist', ['2026-02-30T10:00:00.000000Z', 1]],
  ['an id of zero', [INSTANT, 0]],
  ['an id that is not a whole number', [INSTANT, 1.5]],
  ['an id that is a text', [INSTANT, '1']],
  ['an instant alone', [INSTANT]],
  ['a third element', [INSTANT, 1, 1]],
])('the position of %s is a 400 bad_request', (_label, value) => {
  expect(() => decodeCursor(instantPositionSchema, encodeCursor(value))).toThrow(
    expect.objectContaining({ status: 400, code: 'bad_request' }),
  );
});
