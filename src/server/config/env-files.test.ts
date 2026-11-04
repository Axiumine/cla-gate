// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ConfigError } from './config-error.ts';
import { loadConfig } from './env.ts';
import { SAMPLE_DATABASE_URL, sampleEnvironment, secretDirectory } from './secret-fixture/test-support.ts';
import { TEST_SETUP_TOKEN } from './test-support.ts';

// E19-S02: `loadConfig` reads the `N_FILE` variants before it parses, and reports a file problem by variable and cause.

const PRODUCTION = { NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://cla.example.org' };

function linesOf(env: Record<string, string | undefined>): readonly string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.lines;
    }
    throw error;
  }
  throw new Error('expected loadConfig to throw');
}

test('a secret that comes from a file is parsed as if it had been in the variable', () => {
  const files = secretDirectory();
  const config = loadConfig({ DATABASE_URL_FILE: files.write('database_url', `${SAMPLE_DATABASE_URL}\n`) });
  expect(config.databaseUrl.reveal()).toBe(SAMPLE_DATABASE_URL);
});

test('a file with the wrong content is refused by the rule of the variable, and the variable is named, not the file variable', () => {
  const files = secretDirectory();
  const lines = linesOf({ DATABASE_URL_FILE: files.write('database_url', 'not a connection string\n') });
  expect(lines).toEqual([
    'DATABASE_URL: must be a postgres:// or postgresql:// connection string (required; set it, or DATABASE_URL_FILE)',
  ]);
});

test('both the variable and its file is `N, N_FILE: set only one`', () => {
  const files = secretDirectory();
  const lines = linesOf({
    DATABASE_URL: SAMPLE_DATABASE_URL,
    DATABASE_URL_FILE: files.write('database_url', SAMPLE_DATABASE_URL),
  });
  expect(lines).toEqual(['DATABASE_URL, DATABASE_URL_FILE: set only one']);
});

test('a file that cannot be read is `N_FILE: cannot read <path> (CODE)`, and the schema does not report the variable again', () => {
  const files = secretDirectory();
  const missing = files.at('absent');
  expect(linesOf({ DATABASE_URL_FILE: missing })).toEqual([`DATABASE_URL_FILE: cannot read ${missing} (ENOENT)`]);
});

test('a file over 64 KiB is `N_FILE: file is larger than 64 KiB`', () => {
  const files = secretDirectory();
  const lines = linesOf({
    DATABASE_URL: SAMPLE_DATABASE_URL,
    SESSION_SECRET_FILE: files.write('session', 'x'.repeat(65_537)),
  });
  expect(lines).toEqual(['SESSION_SECRET_FILE: file is larger than 64 KiB']);
});

test('a file problem of an optional secret still stops the start: nothing is silently left out', () => {
  const files = secretDirectory();
  const lines = linesOf({ DATABASE_URL: SAMPLE_DATABASE_URL, GITHUB_WEBHOOK_SECRET_FILE: files.root });
  expect(lines).toEqual([`GITHUB_WEBHOOK_SECRET_FILE: cannot read ${files.root} (EISDIR)`]);
});

test('file problems and invalid values are reported together, one line each, sorted by variable', () => {
  const files = secretDirectory();
  const lines = linesOf({
    PORT: 'http',
    DATABASE_URL: SAMPLE_DATABASE_URL,
    SESSION_SECRET: 'x',
    SESSION_SECRET_FILE: files.write('session', 'y'.repeat(40)),
    GITHUB_CLIENT_SECRET_FILE: files.at('absent'),
    SETUP_TOKEN_FILE: files.write('setup', 'short\n'),
  });
  expect(lines).toEqual([
    `GITHUB_CLIENT_SECRET_FILE: cannot read ${files.at('absent')} (ENOENT)`,
    'PORT: must be a whole number from 0 to 65535 (digits only)',
    'SESSION_SECRET, SESSION_SECRET_FILE: set only one',
    'SETUP_TOKEN: must be at least 32 characters',
  ]);
});

test('an empty placeholder file is no value: in production setup mode the token is then required', () => {
  const files = secretDirectory();
  const env = {
    ...PRODUCTION,
    DATABASE_URL: SAMPLE_DATABASE_URL,
    GITHUB_APP_PRIVATE_KEY_FILE: files.write('app_key', ''),
    GITHUB_WEBHOOK_SECRET_FILE: files.write('hook', '\n'),
    GITHUB_CLIENT_SECRET_FILE: files.write('client', '\r\n'),
  };
  expect(linesOf({ ...env, SETUP_TOKEN_FILE: files.write('setup_token', '') })).toEqual([
    'SETUP_TOKEN: required while no GitHub App is configured; set it, or set the GITHUB_* variables',
  ]);
  const config = loadConfig({ ...env, SETUP_TOKEN_FILE: files.write('setup_token', `${TEST_SETUP_TOKEN}\n`) });
  expect(config).toMatchObject({ mode: 'setup', github: { privateKey: undefined, webhookSecret: undefined } });
  expect(config.setupToken?.reveal()).toBe(TEST_SETUP_TOKEN);
});

test('the compose stack: the three credentials come from files, the public values from the environment, mode normal', () => {
  const files = secretDirectory();
  const sample = sampleEnvironment();
  const {
    GITHUB_APP_PRIVATE_KEY: key = '',
    GITHUB_WEBHOOK_SECRET: hook = '',
    GITHUB_CLIENT_SECRET: client = '',
    ...rest
  } = sample;
  const config = loadConfig({
    ...rest,
    NODE_ENV: 'production',
    GITHUB_APP_PRIVATE_KEY_FILE: files.write('app_key', key),
    GITHUB_WEBHOOK_SECRET_FILE: files.write('hook', `${hook}\n`),
    GITHUB_CLIENT_SECRET_FILE: files.write('client', `${client}\r\n`),
  });
  expect(config.mode).toBe('normal');
  expect(config.github.webhookSecret?.reveal()).toBe(hook);
  expect(config.github.clientSecret?.reveal()).toBe(client);
  expect(config.github.privateKey?.pem.reveal()).toBe(key.trim());
});
