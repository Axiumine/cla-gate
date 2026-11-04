// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { loadConfigOrReport } from './boot-config.ts';
import { FakeProcess, UNREACHABLE_DATABASE_URL } from './test-support.ts';

// E19-S02: an invalid configuration is printed as plain text, one line per variable, before any logger exists.

test('a valid environment is the configuration, and nothing is printed', () => {
  const err = vi.fn<(line: string) => void>();
  const signals = new FakeProcess();
  const config = loadConfigOrReport({ env: { DATABASE_URL: UNREACHABLE_DATABASE_URL }, signals, err });
  expect(config?.databaseUrl.reveal()).toBe(UNREACHABLE_DATABASE_URL);
  expect(err).not.toHaveBeenCalled();
  expect(signals.exitCode).toBeUndefined();
});

test('every invalid variable is one line of its own, and the exit code is 1', () => {
  const err = vi.fn<(line: string) => void>();
  const signals = new FakeProcess();
  expect(loadConfigOrReport({ env: { PORT: 'http', LOG_LEVEL: 'loud' }, signals, err })).toBeUndefined();
  expect(err.mock.calls.map(([line]) => line)).toEqual([
    'DATABASE_URL: must be a postgres:// or postgresql:// connection string (required; set it, or DATABASE_URL_FILE)',
    'LOG_LEVEL: must be one of fatal, error, warn, info, debug, trace, silent',
    'PORT: must be a whole number from 0 to 65535 (digits only)',
  ]);
  expect(signals.exitCode).toBe(1);
});

test('the lines go to stderr as plain text when no sink is given', () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  loadConfigOrReport({ env: { PORT: 'http' }, signals: new FakeProcess() });
  expect(stderr.mock.calls.map(([chunk]) => chunk)).toEqual([
    'DATABASE_URL: must be a postgres:// or postgresql:// connection string (required; set it, or DATABASE_URL_FILE)\n',
    'PORT: must be a whole number from 0 to 65535 (digits only)\n',
  ]);
  stderr.mockRestore();
});

test('a failure that is not a configuration error is a bug and is not hidden', () => {
  const env = new Proxy(
    {},
    {
      ownKeys: () => {
        throw new Error('not a ConfigError');
      },
    },
  );
  const err = vi.fn<(line: string) => void>();
  const signals = new FakeProcess();
  expect(() => loadConfigOrReport({ env, signals, err })).toThrow('not a ConfigError');
  expect(err).not.toHaveBeenCalled();
  expect(signals.exitCode).toBeUndefined();
});
