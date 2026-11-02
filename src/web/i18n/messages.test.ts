// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { type MessageKey, messages } from './messages.ts';
import { catalogProblems, KEY_PATTERN, placeholdersOf } from './test-support.ts';

// The rules the catalog keeps (E17-S02). The checker is test-support.ts; the second half of this file proves it fails on
// each broken catalog, because the real catalog may hold no plural yet and a checker that never fires proves nothing.

test.each(Object.keys(messages))('the key %s is dotted, lower-case at the start of every segment', (key) => {
  expect(key).toMatch(KEY_PATTERN);
});

test.each(Object.entries(messages))('the message %s is a non-empty string', (_key, value) => {
  expect(typeof value).toBe('string');
  expect(value.trim()).not.toBe('');
});

test('the English catalog is sound: keys, values, braces and plural pairs', () => {
  expect(catalogProblems(messages)).toEqual([]);
});

test('MessageKey is the key set of the catalog: a key of the catalog is one, an invented one is not', () => {
  const known: MessageKey = 'common.close';
  expect(known in messages).toBe(true);
  // @ts-expect-error -- the point of the test: a key that is not in the catalog is not a MessageKey
  const invented: MessageKey = 'common.invented';
  expect(invented in messages).toBe(false);
});

test.each([
  ['one segment', 'close', 'Close'],
  ['an upper-case first letter', 'Common.close', 'Close'],
  ['an upper-case first letter of a later segment', 'common.Close', 'Close'],
  ['a dash', 'common.close-all', 'Close'],
  ['an empty segment', 'common..close', 'Close'],
  ['a trailing dot', 'common.close.', 'Close'],
  ['a digit first', 'common.1close', 'Close'],
  ['an underscore first', 'common._close', 'Close'],
  ['an underscore at the start of the key', '_common.close', 'Close'],
])('a catalog with %s as its key is not sound', (_what, key, text) => {
  expect(catalogProblems({ [key]: text })).toEqual([`${key}: not a dotted key`]);
});

test.each(['errors.csrf_invalid', 'errors.too_many_requests', 'login.failed.state_mismatch'])(
  'a snake_case segment is part of a sound key, because an error code and a login reason are written that way (%s)',
  (key) => {
    expect(catalogProblems({ [key]: 'Text' })).toEqual([]);
  },
);

test.each([
  ['an empty string', ''],
  ['a number', 4],
  ['null', null],
  ['an object', { text: 'Close' }],
])('a catalog whose value is %s is not sound', (_what, value) => {
  expect(catalogProblems({ 'common.close': value })).toEqual(['common.close: not a non-empty string']);
});

test.each([
  ['an unclosed brace', 'Hello {name'],
  ['a closing brace alone', 'Hello name}'],
  ['an empty pair', 'Hello {}'],
  ['a pair with a space', 'Hello { name }'],
  ['a number for a name', 'Hello {1}'],
  ['an upper-case name', 'Hello {Name}'],
])('a message with %s is not sound, because the types and the runtime would disagree on it', (_what, text) => {
  expect(catalogProblems({ 'greeting.hello': text })).toEqual(['greeting.hello: a brace that is not a placeholder']);
});

test('placeholders are lower-camel names, and a message may use several, or the same one twice', () => {
  expect(placeholdersOf('{count} of {total}, {count} again, {userName}')).toEqual(['count', 'total', 'userName']);
  expect(placeholdersOf('No placeholder')).toEqual([]);
  expect(
    catalogProblems({ 'repos.count.one': '{count} of {userName}', 'repos.count.other': '{userName} has {count}' }),
  ).toEqual([]);
});

test('a .one key without a .other sibling is not sound', () => {
  expect(catalogProblems({ 'repos.count.one': '{count} repository' })).toEqual(['repos.count.one: no .other sibling']);
});

test('a .one key whose .other sibling is not text is not sound', () => {
  expect(catalogProblems({ 'repos.count.one': 'One', 'repos.count.other': 5 })).toEqual([
    'repos.count.one: no .other sibling',
    'repos.count.other: not a non-empty string',
  ]);
});

test.each([
  ['a missing placeholder', '{count} repository', 'repositories'],
  ['an extra placeholder', '{count} repository', '{count} repositories of {owner}'],
  ['a misspelt placeholder', '{count} repository', '{cuont} repositories'],
])('a plural pair with %s in the other form is not sound', (_what, one, other) => {
  expect(catalogProblems({ 'repos.count.one': one, 'repos.count.other': other })).toEqual([
    'repos.count.one: its .other sibling uses different placeholders',
  ]);
});

test('a .other key alone is sound: only a .one key needs its sibling', () => {
  expect(catalogProblems({ 'repos.count.other': '{count} repositories' })).toEqual([]);
});
