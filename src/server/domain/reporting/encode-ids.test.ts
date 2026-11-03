// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { InvalidIdError, InvalidShaError, renderId, shortSha } from './encode.ts';

// E09-S01, shortSha and renderId: a SHA is shown only when it is a full lower-case hex SHA, and a number only when it is a
// safe integer. Anything else throws an error that carries no part of the input.

const SHA1 = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';
const SHA256 = `${SHA1}0123456789abcdef01234567`;

test.each([
  ['a SHA-1', SHA1, '1a2b3c4'],
  ['a SHA-256', SHA256, '1a2b3c4'],
  ['forty zeros', '0'.repeat(40), '0000000'],
])('shortSha gives the first seven characters of %s', (_what, sha, expected) => {
  expect(shortSha(sha)).toBe(expected);
});

test('the SHA-256 fixture is 64 characters', () => {
  expect(SHA256).toHaveLength(64);
});

test.each([
  ['nothing', ''],
  ['seven characters', '1a2b3c4'],
  ['39 characters', SHA1.slice(1)],
  ['41 characters', `${SHA1}0`],
  ['63 characters', SHA256.slice(1)],
  ['65 characters', `${SHA256}0`],
  ['upper case', SHA1.toUpperCase()],
  ['one upper-case digit', `A${SHA1.slice(1)}`],
  ['a non-hex letter', `g${SHA1.slice(1)}`],
  ['a trailing line feed', `${SHA1}\n`],
  ['a leading space', ` ${SHA1}`],
  ['a hostile name', '<script>alert(1)</script>'],
  ['a SHA with a hostile tail', `${SHA1}@everyone`],
])('shortSha refuses %s', (_what, sha) => {
  expect(() => shortSha(sha)).toThrow(InvalidShaError);
});

test('the error names itself and holds nothing of the input', () => {
  expect(() => shortSha('@everyone <script>')).toThrow(
    expect.objectContaining({ name: 'InvalidShaError', message: 'Not a full lower-case commit SHA' }),
  );
});

test.each([
  ['zero', 0, '0'],
  ['one', 1, '1'],
  ['a GitHub id', 583231, '583231'],
  ['the largest safe integer', Number.MAX_SAFE_INTEGER, '9007199254740991'],
])('renderId prints %s', (_what, id, expected) => {
  expect(renderId(id)).toBe(expected);
});

test.each([
  ['one past the largest safe integer', Number.MAX_SAFE_INTEGER + 1],
  ['a fraction', 1.5],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['minus Infinity', Number.NEGATIVE_INFINITY],
  ['one past the smallest safe integer', Number.MIN_SAFE_INTEGER - 1],
])('renderId refuses %s', (_what, id) => {
  expect(() => renderId(id)).toThrow(InvalidIdError);
});

test('the id error names itself and holds nothing of the input', () => {
  expect(() => renderId(Number.NaN)).toThrow(
    expect.objectContaining({ name: 'InvalidIdError', message: 'Not a safe integer id' }),
  );
});
