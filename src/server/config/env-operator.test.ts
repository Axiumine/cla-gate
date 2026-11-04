// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ConfigError } from './config-error.ts';
import { loadConfig } from './env.ts';
import { ruleOf } from './env-rules.ts';

// `OPERATOR_GITHUB_IDS` in the environment (E11-S08): optional, read as numbers, and an invalid one is a ConfigError that
// names the variable and never its value.

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
  ['empty', { OPERATOR_GITHUB_IDS: '' }],
  ['blank', { OPERATOR_GITHUB_IDS: '  ' }],
])('the operator ids are undefined when the variable is %s: the owner of the App decides', (_label, env) => {
  expect(loadConfig({ DATABASE_URL: DB, ...env }).github.operatorGithubIds).toBeUndefined();
});

test('the operator ids are read as numbers, trimmed and without duplicates', () => {
  const { github } = loadConfig({ DATABASE_URL: DB, OPERATOR_GITHUB_IDS: ' 9001, 42 ,9001' });
  expect(github.operatorGithubIds).toEqual([9001, 42]);
});

test('the operator ids and the allowed accounts are two settings', () => {
  const { github } = loadConfig({ DATABASE_URL: DB, OPERATOR_GITHUB_IDS: '5', GITHUB_ALLOWED_ACCOUNT_IDS: '6,7' });
  expect([github.operatorGithubIds, github.allowedAccountIds]).toEqual([[5], [6, 7]]);
});

test.each([
  ['a login', 'octocat'],
  ['a negative number', '-1'],
  ['zero', '0'],
  ['a number above Number.MAX_SAFE_INTEGER', '9007199254740993'],
  ['an empty element', '1,,2'],
  ['21 distinct ids', Array.from({ length: 21 }, (_unused, index) => index + 1).join(',')],
])('%s in OPERATOR_GITHUB_IDS is a ConfigError naming the variable, never the value', (_label, value) => {
  const error = capture({ OPERATOR_GITHUB_IDS: value });
  expect(error.variables).toEqual(['OPERATOR_GITHUB_IDS']);
  expect(error.lines).toEqual([`OPERATOR_GITHUB_IDS: ${ruleOf('OPERATOR_GITHUB_IDS')}`]);
});

test('a bad list is reported together with the other invalid variables', () => {
  const error = capture({ OPERATOR_GITHUB_IDS: 'octocat', GITHUB_APP_ID: 'abc' });
  expect(error.variables).toEqual(['GITHUB_APP_ID', 'OPERATOR_GITHUB_IDS']);
});
