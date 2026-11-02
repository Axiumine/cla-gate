// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { readSessionCookie, type SessionCookie } from './session-cookie.ts';

// What a Cookie header says about the session (E10-S02), including the headers a hostile client can send.

const ID = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v';
const OTHER = 'zY-_xW9vU8tS7rQ6pO5nM4lK3jI2hG1fE0dC9bA8aZ7';
const absent: SessionCookie = { kind: 'absent' };
const unusable: SessionCookie = { kind: 'unusable' };

test('the ids of these tests are 43 characters', () => {
  expect([ID.length, OTHER.length]).toEqual([43, 43]);
});

test.each<[string, string | undefined, SessionCookie]>([
  ['no header at all', undefined, absent],
  ['an empty header', '', absent],
  ['a cookie of another name', `session=${ID}`, absent],
  ['the name without the prefix', `cla_session=${ID}`, absent],
  ['the prefix in lower case', `__host-cla_session=${ID}`, absent],
  ['a longer name that ends in ours', `x__Host-cla_session=${ID}`, absent],
  ['a longer name that starts with ours', `__Host-cla_session_2=${ID}`, absent],
  ['a pair without an equals sign', '__Host-cla_session', absent],
  ['a pair that starts with the equals sign', `=${ID}`, absent],
  ['the cookie alone', `__Host-cla_session=${ID}`, { kind: 'id', id: ID }],
  ['an id with the URL-safe characters', `__Host-cla_session=${OTHER}`, { kind: 'id', id: OTHER }],
  ['the cookie among others', `a=1; __Host-cla_session=${ID}; b=2`, { kind: 'id', id: ID }],
  ['the cookie with spaces around the pair', `a=1;   __Host-cla_session=${ID}  ;b=2`, { kind: 'id', id: ID }],
])('%s', (_label, header, expected) => {
  expect(readSessionCookie(header)).toEqual(expected);
});

test.each<[string, string]>([
  ['an empty value', '__Host-cla_session='],
  ['42 characters', `__Host-cla_session=${ID.slice(1)}`],
  ['44 characters', `__Host-cla_session=${ID}A`],
  ['a long value', `__Host-cla_session=${'A'.repeat(4096)}`],
  ['a padded base64 value', `__Host-cla_session=${ID.slice(0, 42)}=`],
  ['a standard base64 plus sign', `__Host-cla_session=${ID.slice(0, 42)}+`],
  ['a slash', `__Host-cla_session=${ID.slice(0, 42)}/`],
  ['a percent-encoded character', `__Host-cla_session=%41${ID.slice(3)}`],
  ['a quoted value', `__Host-cla_session="${ID}"`],
  ['a value with a dot', `__Host-cla_session=${ID.slice(0, 42)}.`],
  ['an SQL fragment of the right length', `__Host-cla_session=${"' or 1=1 --".padEnd(43, 'x')}`],
])('a value of %s is unusable', (_label, header) => {
  expect(readSessionCookie(header)).toEqual(unusable);
});

test.each<[string, string]>([
  ['the same id twice', `__Host-cla_session=${ID}; __Host-cla_session=${ID}`],
  ['two different valid ids', `__Host-cla_session=${ID}; __Host-cla_session=${OTHER}`],
  ['a valid id and then a malformed one', `__Host-cla_session=${ID}; __Host-cla_session=short`],
  ['a malformed value and then a valid id', `__Host-cla_session=short; __Host-cla_session=${ID}`],
  ['two cookies with other cookies between them', `__Host-cla_session=${ID}; a=1; __Host-cla_session=${OTHER}`],
])('two cookies of the same name are ambiguous, so unusable: %s', (_label, header) => {
  expect(readSessionCookie(header)).toEqual(unusable);
});
