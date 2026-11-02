// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ConfigError, loadConfig } from './env.ts';
import { testRsaKey } from './test-support.ts';

const DB = 'postgres://cla_app:s3cr3t-pw@db.internal:5432/cla';

function capture(env: Record<string, string>): ConfigError {
  try {
    loadConfig({ DATABASE_URL: DB, ...env });
  } catch (error) {
    if (error instanceof ConfigError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected loadConfig to throw');
}

test.each([
  ['unset', {}],
  ['empty', { GITHUB_ALLOWED_ACCOUNT_IDS: '' }],
  ['blank', { GITHUB_ALLOWED_ACCOUNT_IDS: '  ' }],
])('the allowed account ids are empty when the variable is %s: the App owner only', (_label, env) => {
  expect(loadConfig({ DATABASE_URL: DB, ...env }).github.allowedAccountIds).toEqual([]);
});

test('the allowed account ids are read as numbers, trimmed and without duplicates', () => {
  const { github } = loadConfig({ DATABASE_URL: DB, GITHUB_ALLOWED_ACCOUNT_IDS: ' 9001, 42 ,9001' });
  expect(github.allowedAccountIds).toEqual([9001, 42]);
});

test.each([
  ['a login', 'octocat'],
  ['a negative number', '-1'],
  ['zero', '0'],
  ['a number above Number.MAX_SAFE_INTEGER', '9007199254740993'],
  ['101 distinct ids', Array.from({ length: 101 }, (_unused, index) => index + 1).join(',')],
])('%s in GITHUB_ALLOWED_ACCOUNT_IDS is a ConfigError naming the variable, never the value', (_label, value) => {
  const error = capture({ GITHUB_ALLOWED_ACCOUNT_IDS: value });
  expect(error.variables).toEqual(['GITHUB_ALLOWED_ACCOUNT_IDS']);
  expect(error.message).toBe('Invalid environment configuration: GITHUB_ALLOWED_ACCOUNT_IDS');
});

test('a bad list is reported together with the other invalid variables', () => {
  const error = capture({ GITHUB_ALLOWED_ACCOUNT_IDS: 'octocat', GITHUB_APP_ID: 'abc' });
  expect(error.variables).toEqual(['GITHUB_ALLOWED_ACCOUNT_IDS', 'GITHUB_APP_ID']);
});

test('the list is optional in production: the owner account alone is served', () => {
  const { github } = loadConfig({
    DATABASE_URL: DB,
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: 'https://cla.example.org',
    GITHUB_APP_ID: '12345',
    GITHUB_APP_PRIVATE_KEY: testRsaKey().pkcs8,
  });
  expect(github.allowedAccountIds).toEqual([]);
});
