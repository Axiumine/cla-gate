// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { interpolate } from './interpolate.ts';

test.each([
  ['one placeholder', 'Hello {name}', { name: 'Ada' }, 'Hello Ada'],
  ['two placeholders', '{a} and {b}', { a: 'x', b: 'y' }, 'x and y'],
  ['the same placeholder twice', '{a}{a}', { a: 'x' }, 'xx'],
  ['a number', '{count} items', { count: 3 }, '3 items'],
  ['zero, which is a value and not a missing one', '{count} items', { count: 0 }, '0 items'],
  ['an empty string, which is a value too', 'Hi {name}!', { name: '' }, 'Hi !'],
  ['no placeholder at all', 'Plain text', { unused: 'x' }, 'Plain text'],
])('replaces %s', (_what, message, values, expected) => {
  expect(interpolate(message, values)).toBe(expected);
});

test.each([
  ['its own name', 'Hello {name}', { name: '{name}' }, 'Hello {name}'],
  ['the name of another placeholder', '{a} then {b}', { a: '{b}', b: 'B' }, '{b} then B'],
  ['a brace alone', 'Hello {name}', { name: '{' }, 'Hello {'],
  ['a brace pair that is no name', 'Hello {name}', { name: '{ }' }, 'Hello { }'],
  ['the pattern $& of String.replace', 'Hello {name}', { name: '$&' }, 'Hello $&'],
  ['the patterns $1 and $` of String.replace', 'Hello {name}', { name: '$1 $`' }, 'Hello $1 $`'],
])('a value that holds %s is shown as typed and read again by nothing', (_what, message, values, expected) => {
  expect(interpolate(message, values)).toBe(expected);
});

test.each([
  ['no value at all', '{name}', {}],
  ['a value for another name', 'Hello {name}', { other: 'x' }],
  ['a name that every object has', '{constructor}', {}],
  ['the name toString', '{toString}', {}],
])('a placeholder with %s stays as written, and never shows a built-in', (_what, message, values) => {
  expect(interpolate(message, values)).toBe(message);
});

test('only well-formed placeholders count: a brace without a name or with a bad one is left alone', () => {
  expect(interpolate('{ name } {Name} {1} {} {name', { name: 'x', Name: 'y', 1: 'z' })).toBe(
    '{ name } {Name} {1} {} {name',
  );
});
