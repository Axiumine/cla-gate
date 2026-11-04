// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ConfigError } from './config-error.ts';
import { loadConfig } from './env.ts';

// WORKER_CONCURRENCY (E07-S03): how many jobs of one queue run at once; an integer from 1 to 32, default 4.

const DB = 'postgres://cla_app:made-up@db.internal:5432/cla';
const concurrencyOf = (value: string | undefined): number =>
  loadConfig({ DATABASE_URL: DB, ...(value === undefined ? {} : { WORKER_CONCURRENCY: value }) }).workerConcurrency;

test('the default is 4, and an empty variable counts as unset', () => {
  expect(concurrencyOf(undefined)).toBe(4);
  expect(concurrencyOf('')).toBe(4);
});

test.each(['1', '2', '4', '9', '10', '16', '31', '32'])('%s is accepted and read as a number', (value) => {
  expect(concurrencyOf(value)).toBe(Number(value));
});

test.each([
  '0',
  '33',
  '99',
  '100',
  '-1',
  '+4',
  '4.5',
  '04',
  '00',
  ' 4',
  '4 ',
  'four',
  '1e1',
  '0x10',
  '4,5',
  '٤',
  'Infinity',
  'NaN',
])('WORKER_CONCURRENCY=%s is a ConfigError naming the variable, never a value', (value) => {
  let error: unknown;
  try {
    concurrencyOf(value);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(ConfigError);
  expect(error).toMatchObject({ variables: ['WORKER_CONCURRENCY'] });
  expect(String(error)).not.toContain(`=${value}`);
});
