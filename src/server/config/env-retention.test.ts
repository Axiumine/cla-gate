// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ConfigError } from './config-error.ts';
import { loadConfig } from './env.ts';
import { ruleOf } from './env-rules.ts';

// `NETWORK_METADATA_RETENTION_DAYS` in the environment (E16-S05): a whole number of days from 1 to 90, 30 when unset, and
// anything else is a ConfigError that names the variable and never its value.

const DB = 'postgres://cla_app:s3cr3t-pw@db.internal:5432/cla';

const retentionOf = (value: string | undefined) =>
  loadConfig({ DATABASE_URL: DB, ...(value === undefined ? {} : { NETWORK_METADATA_RETENTION_DAYS: value }) })
    .networkMetadataRetentionDays;

function capture(value: string): ConfigError {
  try {
    loadConfig({ DATABASE_URL: DB, NETWORK_METADATA_RETENTION_DAYS: value });
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
])('the retention is 30 days when the variable is %s', (_label, value) => {
  expect(retentionOf(value)).toBe(30);
});

test.each([
  ['1', 1],
  ['7', 7],
  ['30', 30],
  ['89', 89],
  ['90', 90],
])('%s days is accepted and read as a number', (value, days) => {
  expect(retentionOf(value)).toBe(days);
});

test.each([
  ['zero', '0'],
  ['one above the maximum', '91'],
  ['a negative number', '-5'],
  ['a fraction', '1.5'],
  ['an exponent', '3e1'],
  ['a word', 'thirty'],
  ['a sign', '+30'],
  ['a unit', '30d'],
  ['spaces', ' 30 '],
  ['three digits', '100'],
  ['a huge number', '99999999999999999999'],
])('%s is a ConfigError naming the variable, never the value', (_label, value) => {
  const error = capture(value);
  expect(error.variables).toEqual(['NETWORK_METADATA_RETENTION_DAYS']);
  expect(error.lines).toEqual([`NETWORK_METADATA_RETENTION_DAYS: ${ruleOf('NETWORK_METADATA_RETENTION_DAYS')}`]);
});
