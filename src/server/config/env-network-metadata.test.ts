// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { ConfigError, loadConfig } from './env.ts';

// `RECORD_NETWORK_METADATA` in the environment (E13-S05): exactly `true` or `false`, `false` when unset, and anything else is a
// ConfigError that names the variable and never its value. A typo must not switch the recording of personal data on, nor leave
// off a switch the operator believes is on.

const DB = 'postgres://cla_app:s3cr3t-pw@db.internal:5432/cla';

const recordOf = (value: string | undefined) =>
  loadConfig({ DATABASE_URL: DB, ...(value === undefined ? {} : { RECORD_NETWORK_METADATA: value }) })
    .recordNetworkMetadata;

function capture(value: string): ConfigError {
  try {
    loadConfig({ DATABASE_URL: DB, RECORD_NETWORK_METADATA: value });
  } catch (error) {
    if (error instanceof ConfigError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected loadConfig to throw');
}

test.each([
  ['unset', undefined],
  ['empty', ''],
  ['false', 'false'],
])('recording is off when the variable is %s', (_label, value) => {
  expect(recordOf(value)).toBe(false);
});

test('recording is on only for the value true', () => {
  expect(recordOf('true')).toBe(true);
});

test.each([
  ['upper case', 'TRUE'],
  ['capitalised', 'True'],
  ['upper case false', 'FALSE'],
  ['one', '1'],
  ['zero', '0'],
  ['yes', 'yes'],
  ['on', 'on'],
  ['padded', ' true '],
  ['a word', 'enabled'],
  ['a list', 'true,false'],
])('%s is a ConfigError naming the variable, never the value', (_label, value) => {
  const error = capture(value);
  expect(error.variables).toEqual(['RECORD_NETWORK_METADATA']);
  expect(error.message).toBe('Invalid environment configuration: RECORD_NETWORK_METADATA');
});

test('.env.example lists the variable with the safe default, and its comment says what it records', () => {
  const text = fs.readFileSync(path.resolve(import.meta.dirname, '../../../.env.example'), 'utf8');
  expect(text).toMatch(/^RECORD_NETWORK_METADATA=false$/mu);
  expect(text).toContain('IP address and the user agent');
});
