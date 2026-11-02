// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { messages } from './messages.ts';
import { createTranslator } from './translate.ts';

const catalog = {
  'hello.world': 'Hello world',
  'hello.name': 'Hello {name}',
  'range.pair': '{from} to {to}',
  'repos.count.one': '{count} repository',
  'repos.count.other': '{count} repositories',
  'repos.owned.one': '{count} repository of {owner}',
  'repos.owned.other': '{count} repositories of {owner}',
  'lonely.one': 'Just one',
} as const;

const t = createTranslator(catalog, 'en');

test('a message without placeholders is its text', () => {
  expect(t('hello.world')).toBe('Hello world');
});

test('the real catalog answers through the same function', () => {
  expect(createTranslator(messages, 'en')('common.close')).toBe('Close');
});

test.each([
  ['one placeholder', 'Ada'],
  ['a placeholder with a number', 7],
])('a placeholder is replaced: %s', (_what, name) => {
  expect(t('hello.name', { name })).toBe(`Hello ${name}`);
});

test('the order of the parameter object does not matter', () => {
  expect(t('range.pair', { to: 'b', from: 'a' })).toBe('a to b');
});

test('a parameter value that is itself a placeholder is not read again', () => {
  expect(t('hello.name', { name: '{name}' })).toBe('Hello {name}');
  expect(t('range.pair', { from: '{to}', to: 'b' })).toBe('{to} to b');
});

test('a parameter value with a brace that is no placeholder is returned untouched', () => {
  expect(t('hello.name', { name: '{ x }' })).toBe('Hello { x }');
  expect(t('hello.name', { name: '}{' })).toBe('Hello }{');
});

test('a key the catalog does not have shows as the key, never as nothing', () => {
  const wide: Readonly<Record<string, string>> = { 'hello.world': 'Hello world' };
  expect(createTranslator(wide, 'en')('missing.key')).toBe('missing.key');
});

// What `tsc` refuses. Each line below carries @ts-expect-error: if the compiler ever accepts it, the directive itself is
// the error and `yarn typecheck` fails. The values are still checked at run time, for what the app would show.

test('a missing parameter fails tsc', () => {
  // @ts-expect-error -- the point of the test: Hello {name} needs a name
  expect(t('hello.name')).toBe('Hello {name}');
});

test('a misspelt parameter fails tsc', () => {
  // @ts-expect-error -- the point of the test: nmae is not name
  expect(t('hello.name', { nmae: 'Ada' })).toBe('Hello {name}');
});

test('a parameter the message does not use fails tsc', () => {
  // @ts-expect-error -- the point of the test: extra is no placeholder of Hello {name}
  expect(t('hello.name', { name: 'Ada', extra: 1 })).toBe('Hello Ada');
});

test('one of two parameters missing fails tsc', () => {
  // @ts-expect-error -- the point of the test: {from} to {to} needs both
  expect(t('range.pair', { from: 'a' })).toBe('a to {to}');
});

test('a parameter object for a message without placeholders fails tsc', () => {
  // @ts-expect-error -- the point of the test: Hello world has no placeholder to fill
  expect(t('hello.world', { name: 'Ada' })).toBe('Hello world');
});

test('a key that is not in the catalog fails tsc', () => {
  // @ts-expect-error -- the point of the test: there is no hello.nobody
  expect(t('hello.nobody')).toBe('hello.nobody');
});

test.each([
  ['zero', 0, '0 repositories'],
  ['one', 1, '1 repository'],
  ['two', 2, '2 repositories'],
  ['a fraction', 1.5, '1.5 repositories'],
  ['a thousand and more, written with the digit grouping of the locale', 1234, '1,234 repositories'],
])('plural, %s: the count picks .one or .other and fills {count}', (_what, count, expected) => {
  expect(t.plural('repos.count', count)).toBe(expected);
});

test('plural fills the placeholders besides count from the parameter object', () => {
  expect(t.plural('repos.owned', 1, { owner: 'octocat' })).toBe('1 repository of octocat');
  expect(t.plural('repos.owned', 3, { owner: 'octocat' })).toBe('3 repositories of octocat');
});

test('plural does not read a parameter value as a placeholder either', () => {
  expect(t.plural('repos.owned', 2, { owner: '{count}' })).toBe('2 repositories of {count}');
});

test('plural writes the count in the digits of the locale of the translator', () => {
  expect(createTranslator(catalog, 'de').plural('repos.count', 1234)).toBe('1.234 repositories');
});

test('plural only takes a base that has both forms, and the parameters of the message', () => {
  // @ts-expect-error -- the point of the test: lonely has a .one and no .other
  expect(t.plural('lonely', 2)).toBe('lonely.other');
  // @ts-expect-error -- the point of the test: repos.owned needs its owner
  expect(t.plural('repos.owned', 1)).toBe('1 repository of {owner}');
  // @ts-expect-error -- the point of the test: repos.count has no placeholder but count
  expect(t.plural('repos.count', 1, { owner: 'octocat' })).toBe('1 repository');
  // @ts-expect-error -- the point of the test: hello.world is no plural base
  expect(t.plural('hello.world', 1)).toBe('hello.world.one');
});
