// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { redact } from './redact.ts';

// E19-S08: the logs of a failed run leave the runner as an artifact, so no secret value of the stack may be in them.

test('every occurrence of every secret is replaced', () => {
  const value = 'a1b2c3d4e5f6a7b8';
  expect(redact(`x ${value} y ${value}`, [value])).toBe('x [redacted] y [redacted]');
});

test('a URL that holds a password is replaced as a whole, the longer secret first', () => {
  const password = 'p'.repeat(16);
  const url = `postgres://cla_app:${password}@postgres:5432/cla`;
  expect(redact(`dsn ${url}`, [password, url])).toBe('dsn [redacted]');
});

test('a value shorter than eight characters, and an empty placeholder file, are left alone', () => {
  expect(redact('abc abc abcdefg', ['abc', '', 'abcdefg'])).toBe('abc abc abcdefg');
});

test('a value of exactly eight characters is replaced', () => {
  expect(redact('token12345678', ['12345678'])).toBe('token[redacted]');
});

test('no secrets leave the text as it was', () => {
  expect(redact('plain', [])).toBe('plain');
});
