// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { DEFAULT_SOURCE_URL } from '../../shared/meta.ts';
import { ConfigError, loadConfig } from './env.ts';

// E17-S09: SOURCE_URL and SOURCE_COMMIT, where the corresponding source of the running version is (AGPL section 13).

const DB = 'postgres://cla_app:pw@db.internal:5432/cla';
const COMMIT = 'a'.repeat(20) + 'b'.repeat(20);

const source = (env: Record<string, string | undefined>) => loadConfig({ DATABASE_URL: DB, ...env }).source;

test('without either variable the repository is the default and the commit is not known', () => {
  expect(source({})).toEqual({ url: DEFAULT_SOURCE_URL, commit: null });
});

test.each([[undefined], [''], ['unknown'], ['   '], [' unknown\n']])('SOURCE_COMMIT=%j is not known: null', (value) => {
  expect(source({ SOURCE_COMMIT: value }).commit).toBeNull();
});

test('a commit of 40 hexadecimal characters is kept in lower case, with the white space around it removed', () => {
  expect(source({ SOURCE_COMMIT: COMMIT }).commit).toBe(COMMIT);
  expect(source({ SOURCE_COMMIT: COMMIT.toUpperCase() }).commit).toBe(COMMIT);
  expect(source({ SOURCE_COMMIT: `${COMMIT}\n` }).commit).toBe(COMMIT);
});

test.each([
  ['39 characters', COMMIT.slice(1)],
  ['41 characters', `${COMMIT}0`],
  ['a character that is not hexadecimal', `${COMMIT.slice(1)}g`],
  ['a short id', 'abc1234'],
  ['UNKNOWN in capitals', 'UNKNOWN'],
  ['a branch name', 'main'],
])('SOURCE_COMMIT with %s is refused by name, not by value', (_name, value) => {
  const attempt = () => source({ SOURCE_COMMIT: value });
  expect(attempt).toThrow(ConfigError);
  expect(attempt).toThrow('SOURCE_COMMIT');
  expect(attempt).not.toThrow(value);
});

test('an https address is kept, and one trailing slash or white space around it is forgiven', () => {
  expect(source({ SOURCE_URL: 'https://git.example.test/org/cla' }).url).toBe('https://git.example.test/org/cla');
  expect(source({ SOURCE_URL: 'https://git.example.test/org/cla/' }).url).toBe('https://git.example.test/org/cla');
  expect(source({ SOURCE_URL: ' https://git.example.test/org/cla\n' }).url).toBe('https://git.example.test/org/cla');
});

test('an empty SOURCE_URL is unset, so the default applies', () => {
  expect(source({ SOURCE_URL: '' }).url).toBe(DEFAULT_SOURCE_URL);
});

test.each([
  ['plain http', 'http://git.example.test/org/cla'],
  ['a javascript: address', 'javascript:alert(1)'],
  ['credentials', 'https://user:pw@git.example.test/org/cla'],
  ['a query', 'https://git.example.test/org/cla?x=1'],
  ['a fragment', 'https://git.example.test/org/cla#x'],
  ['two trailing slashes', 'https://git.example.test/org/cla//'],
  ['a path without a scheme', 'git.example.test/org/cla'],
  ['white space only', '   '],
])('SOURCE_URL with %s is refused by name, not by value', (_name, value) => {
  const attempt = () => source({ SOURCE_URL: value });
  expect(attempt).toThrow(ConfigError);
  expect(attempt).toThrow('SOURCE_URL');
  expect(attempt).not.toThrow('pw@');
});
