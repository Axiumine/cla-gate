// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { auditCursorSchema, encodeAuditCursor } from './audit-cursor.ts';

const INSTANT = '2026-11-02T10:00:00.123456Z';

/** What a client could make of a cursor by hand: base64url of any JSON text. */
const cursorOf = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

test('a cursor is the base64url of the JSON pair of the microsecond instant and the id', () => {
  const text = encodeAuditCursor({ occurredAt: INSTANT, id: 42 });
  expect(text).toMatch(/^[\w-]+$/);
  expect(Buffer.from(text, 'base64url').toString('utf8')).toBe('["2026-11-02T10:00:00.123456Z",42]');
});

test.each([1, 42, 9_007_199_254_740_991])('the cursor of the id %i is read back as it was written', (id) => {
  const cursor = { occurredAt: INSTANT, id };
  expect(auditCursorSchema.parse(encodeAuditCursor(cursor))).toEqual(cursor);
});

test.each([
  ['an empty string', ''],
  ['text that is not base64url', 'not a cursor!'],
  ['base64url with the padding of standard base64', `${encodeAuditCursor({ occurredAt: INSTANT, id: 12 })}==`],
  ['standard base64 with its alphabet', Buffer.from([0xfb, 0xff, 0xfe]).toString('base64')],
  ['base64url that is not JSON', Buffer.from('hello').toString('base64url')],
  ['a single character, which is not a whole byte', 'A'],
  ['a JSON object', cursorOf({ occurredAt: INSTANT, id: 1 })],
  ['a JSON string', cursorOf(INSTANT)],
  ['a pair with a third element', cursorOf([INSTANT, 1, 2])],
  ['a pair with one element', cursorOf([INSTANT])],
  ['a pair with the elements the wrong way round', cursorOf([1, INSTANT])],
  ['an id that is a string', cursorOf([INSTANT, '1'])],
  ['an id of zero', cursorOf([INSTANT, 0])],
  ['a negative id', cursorOf([INSTANT, -5])],
  ['an id with a fraction', cursorOf([INSTANT, 1.5])],
  ['an id past the safe integers', Buffer.from(`["${INSTANT}",9007199254740993]`).toString('base64url')],
  ['an instant with milliseconds only', cursorOf(['2026-11-02T10:00:00.123Z', 1])],
  ['an instant with no fraction', cursorOf(['2026-11-02T10:00:00Z', 1])],
  ['an instant with an offset', cursorOf(['2026-11-02T10:00:00.123456+01:00', 1])],
  ['a day that the month does not have', cursorOf(['2026-02-30T10:00:00.123456Z', 1])],
  ['an hour that the day does not have', cursorOf(['2026-11-02T25:00:00.123456Z', 1])],
  ['an instant in SQL', cursorOf(["2026-11-02T10:00:00.123456Z'; drop table audit_log; --", 1])],
  ['an instant in the year 0000, which the database cannot store', cursorOf(['0000-06-01T00:00:00.000000Z', 1])],
  ['null', cursorOf(null)],
  ['a cursor of more than 128 characters', 'A'.repeat(129)],
])('%s is not a cursor', (_name, text) => {
  expect(auditCursorSchema.safeParse(text).success).toBe(false);
});

test.each(['0001-01-01T00:00:00.000000Z', '9999-12-31T23:59:59.999999Z'])(
  'the instant %s, the first and the last the database stores, is a cursor',
  (occurredAt) => {
    expect(auditCursorSchema.parse(encodeAuditCursor({ occurredAt, id: 7 }))).toEqual({ occurredAt, id: 7 });
  },
);

test('a text that differs from a cursor only in the unused bits of its last character is not a cursor either', () => {
  // 34 bytes of JSON: the last character carries four bits that no byte uses, so sixteen spellings decode to one value.
  const cursor = encodeAuditCursor({ occurredAt: INSTANT, id: 12 });
  expect(cursor).toHaveLength(46);
  const bytes = Buffer.from(cursor, 'base64url');
  const spellings = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_')
    .map((last) => `${cursor.slice(0, -1)}${last}`)
    .filter((text) => Buffer.from(text, 'base64url').equals(bytes));
  expect(spellings).toHaveLength(16);
  expect(spellings.filter((text) => auditCursorSchema.safeParse(text).success)).toEqual([cursor]);
});
