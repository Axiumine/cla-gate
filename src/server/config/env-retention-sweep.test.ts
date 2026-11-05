// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ConfigError } from './config-error.ts';
import { loadConfig } from './env.ts';
import { ruleOf } from './env-rules.ts';

// `RETENTION_WEBHOOK_DELIVERIES_DAYS` and `RETENTION_BATCH_SIZE` in the environment (E22-S04): whole numbers, digits only, 30
// days and 5000 rows when unset, and zod refuses a retention below 7 days, safely above GitHub's 3-day redelivery window.
// Anything else is a ConfigError that names the variable and never its value.

const DB = 'postgres://cla_app:s3cr3t-pw@db.internal:5432/cla';

const settingsOf = (env: Record<string, string>) => loadConfig({ DATABASE_URL: DB, ...env }).retention;

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
  ['empty', { RETENTION_WEBHOOK_DELIVERIES_DAYS: '', RETENTION_BATCH_SIZE: '' }],
])('the retention is 30 days and 5000 rows a batch when the variables are %s', (_label, env) => {
  expect(settingsOf(env)).toEqual({ webhookDeliveriesDays: 30, batchSize: 5000 });
});

test.each([
  ['7', 7],
  ['8', 8],
  ['30', 30],
  ['365', 365],
  ['3650', 3650],
])('%s days is accepted and read as a number', (value, days) => {
  expect(settingsOf({ RETENTION_WEBHOOK_DELIVERIES_DAYS: value }).webhookDeliveriesDays).toBe(days);
});

test.each([
  ['1', 1],
  ['5000', 5000],
  ['99999', 99_999],
  ['100000', 100_000],
])('%s rows a batch is accepted and read as a number', (value, rows) => {
  expect(settingsOf({ RETENTION_BATCH_SIZE: value }).batchSize).toBe(rows);
});

test.each([
  ['one day', '1'],
  ['the 3-day redelivery window itself', '3'],
  ['one below the minimum', '6'],
  ['zero', '0'],
  ['one above the maximum', '3651'],
  ['a negative number', '-7'],
  ['a fraction', '7.5'],
  ['an exponent', '3e1'],
  ['a word', 'thirty'],
  ['a sign', '+30'],
  ['a unit', '30d'],
  ['spaces', ' 30 '],
  ['five digits', '10000'],
  ['a huge number', '99999999999999999999'],
])('a retention of %s is a ConfigError naming the variable, never the value', (_label, value) => {
  const error = capture({ RETENTION_WEBHOOK_DELIVERIES_DAYS: value });
  expect(error.variables).toEqual(['RETENTION_WEBHOOK_DELIVERIES_DAYS']);
  expect(error.lines).toEqual([`RETENTION_WEBHOOK_DELIVERIES_DAYS: ${ruleOf('RETENTION_WEBHOOK_DELIVERIES_DAYS')}`]);
});

test.each(['RETENTION_WEBHOOK_DELIVERIES_DAYS', 'RETENTION_BATCH_SIZE'])('%s never echoes a refused value', (name) => {
  const error = capture({ [name]: 'zzzz-secret-12' });
  expect(error.variables).toEqual([name]);
  expect(error.lines.join('\n')).not.toContain('zzzz');
});

test.each([
  ['zero', '0'],
  ['a leading zero', '05000'],
  ['one above the maximum', '100001'],
  ['a negative number', '-1'],
  ['a fraction', '1.5'],
  ['a word', 'many'],
  ['a unit', '5000rows'],
  ['spaces', ' 5000'],
  ['seven digits', '1000000'],
])('a batch size of %s is a ConfigError naming the variable, never the value', (_label, value) => {
  const error = capture({ RETENTION_BATCH_SIZE: value });
  expect(error.variables).toEqual(['RETENTION_BATCH_SIZE']);
  expect(error.lines).toEqual([`RETENTION_BATCH_SIZE: ${ruleOf('RETENTION_BATCH_SIZE')}`]);
});

test('both invalid settings are reported at once, each by its name', () => {
  const error = capture({ RETENTION_WEBHOOK_DELIVERIES_DAYS: '2', RETENTION_BATCH_SIZE: '0' });
  expect(error.variables).toEqual(['RETENTION_BATCH_SIZE', 'RETENTION_WEBHOOK_DELIVERIES_DAYS']);
});
