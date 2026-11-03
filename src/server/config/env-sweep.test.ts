// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ConfigError } from './config-error.ts';
import { loadConfig } from './env.ts';

// SWEEP_INTERVAL_MINUTES (E07-S08): the minutes between two reconciliation sweeps; 0, 5, 10, 15, 20, 30 or 60, default 30,
// and 0 turns the sweep off. Any other value is a ConfigError.

const DB = 'postgres://cla_app:made-up@db.internal:5432/cla';
const intervalOf = (value: string | undefined): number =>
  loadConfig({ DATABASE_URL: DB, ...(value === undefined ? {} : { SWEEP_INTERVAL_MINUTES: value }) })
    .sweepIntervalMinutes;

test('the default is 30 minutes, and an empty variable counts as unset', () => {
  expect(intervalOf(undefined)).toBe(30);
  expect(intervalOf('')).toBe(30);
});

test.each(['0', '5', '10', '15', '20', '30', '60'])('%s is accepted and read as a number', (value) => {
  expect(intervalOf(value)).toBe(Number(value));
});

test('0 is a real value and not the default: it turns the sweep off', () => {
  expect(intervalOf('0')).toBe(0);
});

test.each([
  '1',
  '2',
  '7',
  '12',
  '25',
  '45',
  '59',
  '61',
  '90',
  '120',
  '1440',
  '-5',
  '+5',
  '05',
  '00',
  '030',
  '5.0',
  '7.5',
  ' 5',
  '5 ',
  '5m',
  'five',
  '1e1',
  '0x0A',
  '5,10',
  '٥',
  'Infinity',
  'NaN',
  'false',
])('SWEEP_INTERVAL_MINUTES=%s is a ConfigError naming the variable, never a value', (value) => {
  let error: unknown;
  try {
    intervalOf(value);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(ConfigError);
  expect(error).toMatchObject({ variables: ['SWEEP_INTERVAL_MINUTES'] });
  expect(String(error)).not.toContain(`=${value}`);
});
