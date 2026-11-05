// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ERASE_USAGE, parseEraseArguments } from './erase-arguments.ts';

// The arguments of `node src/server/erase.ts` (E22-S05): two positive safe integers and an optional --execute, in any order, and
// nothing else.

test('both ids and nothing more is a dry run', () => {
  expect(parseEraseArguments(['--github-id', '42', '--actor-github-id', '7'])).toEqual({
    githubId: 42,
    actor: 7,
    execute: false,
  });
});

test.each([
  ['execute last', ['--github-id', '42', '--actor-github-id', '7', '--execute']],
  ['execute first', ['--execute', '--github-id', '42', '--actor-github-id', '7']],
  ['execute between', ['--github-id', '42', '--execute', '--actor-github-id', '7']],
  ['the ids swapped', ['--actor-github-id', '7', '--github-id', '42', '--execute']],
])('--execute makes a real run, wherever it stands: %s', (_label, argv) => {
  expect(parseEraseArguments(argv)).toEqual({ githubId: 42, actor: 7, execute: true });
});

test('the largest safe integer is accepted and the next one is not', () => {
  expect(parseEraseArguments(['--github-id', '9007199254740991', '--actor-github-id', '1'])?.githubId).toBe(
    Number.MAX_SAFE_INTEGER,
  );
  expect(parseEraseArguments(['--github-id', '9007199254740992', '--actor-github-id', '1'])).toBeUndefined();
});

test('the person and the operator may be the same GitHub id', () => {
  expect(parseEraseArguments(['--github-id', '5', '--actor-github-id', '5'])).toEqual({
    githubId: 5,
    actor: 5,
    execute: false,
  });
});

test.each([
  ['zero', '0'],
  ['a negative number', '-5'],
  ['a plus sign', '+5'],
  ['a fraction', '4.5'],
  ['a whole number with a point', '5.0'],
  ['an exponent', '1e3'],
  ['hexadecimal', '0x10'],
  ['a leading zero', '007'],
  ['a leading space', ' 5'],
  ['a trailing space', '5 '],
  ['a thousands separator', '1,000'],
  ['an underscore separator', '1_000'],
  ['words', 'five'],
  ['an empty string', ''],
  ['the word Infinity', 'Infinity'],
  ['an unsafe integer', '9007199254740993'],
  ['a seventeen-digit number', '12345678901234567'],
  ['a very long number', '9'.repeat(400)],
  ['a SQL fragment', '1; drop table users;--'],
  ['a non-ASCII digit', '٣'],
])('%s is not an id', (_label, text) => {
  expect(parseEraseArguments(['--github-id', text, '--actor-github-id', '7'])).toBeUndefined();
  expect(parseEraseArguments(['--github-id', '7', '--actor-github-id', text])).toBeUndefined();
});

test.each([
  ['no arguments', []],
  ['only the person', ['--github-id', '42']],
  ['only the operator', ['--actor-github-id', '7']],
  ['only --execute', ['--execute']],
  ['a flag without its value at the end', ['--github-id', '42', '--actor-github-id']],
  ['a flag whose value is another flag', ['--github-id', '--actor-github-id', '7']],
  ['a flag whose value is --execute', ['--github-id', '42', '--actor-github-id', '--execute']],
  ['the person twice', ['--github-id', '42', '--github-id', '43', '--actor-github-id', '7']],
  ['the same person twice', ['--github-id', '42', '--github-id', '42', '--actor-github-id', '7']],
  ['the operator twice', ['--github-id', '42', '--actor-github-id', '7', '--actor-github-id', '8']],
  ['--execute twice', ['--github-id', '42', '--actor-github-id', '7', '--execute', '--execute']],
  ['an unknown flag', ['--github-id', '42', '--actor-github-id', '7', '--force']],
  ['a flag with a typo', ['--github-id', '42', '--actor-github-id', '7', '--excute']],
  ['the --flag=value spelling', ['--github-id=42', '--actor-github-id=7']],
  ['a short flag', ['-g', '42', '-a', '7']],
  ['a bare word', ['--github-id', '42', '--actor-github-id', '7', 'now']],
  ['an empty word', ['--github-id', '42', '--actor-github-id', '7', '']],
  ['a value with no flag', ['42', '7']],
  ['a flag in upper case', ['--GITHUB-ID', '42', '--actor-github-id', '7']],
])('%s is a usage error', (_label, argv) => {
  expect(parseEraseArguments(argv)).toBeUndefined();
});

test('the usage line names the command and the three flags and no value', () => {
  expect(ERASE_USAGE).toBe('usage: node src/server/erase.ts --github-id <n> --actor-github-id <n> [--execute]');
});
