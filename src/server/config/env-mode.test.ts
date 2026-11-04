// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { AUTH_ENV } from './auth-fixture/test-support.ts';
import { ConfigError } from './config-error.ts';
import { loadConfig } from './env.ts';
import { SAMPLE_DATABASE_URL, sampleEnvironment } from './secret-fixture/test-support.ts';
import { TEST_SETUP_TOKEN } from './test-support.ts';

// E19-S02: mode resolution through the whole environment: `setup` while no GitHub App is configured, `normal` once all five
// App variables are set, and what each case needs.

const PRODUCTION = {
  DATABASE_URL: SAMPLE_DATABASE_URL,
  NODE_ENV: 'production',
  PUBLIC_BASE_URL: 'https://cla.example.org',
};
const APP = sampleEnvironment();
const FIVE = {
  GITHUB_APP_ID: APP['GITHUB_APP_ID'] ?? '',
  GITHUB_APP_PRIVATE_KEY: APP['GITHUB_APP_PRIVATE_KEY'] ?? '',
  GITHUB_WEBHOOK_SECRET: APP['GITHUB_WEBHOOK_SECRET'] ?? '',
  GITHUB_CLIENT_ID: APP['GITHUB_CLIENT_ID'] ?? '',
  GITHUB_CLIENT_SECRET: APP['GITHUB_CLIENT_SECRET'] ?? '',
};

/** The lines of the error `loadConfig` throws. */
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

test('with all five App variables the mode is normal, and the session secret is required in production', () => {
  const config = loadConfig({ ...PRODUCTION, ...FIVE, SESSION_SECRET: AUTH_ENV['SESSION_SECRET'] });
  expect(config).toMatchObject({ mode: 'normal', setupToken: undefined, setupTokenIgnored: false });
  expect(linesOf({ ...PRODUCTION, ...FIVE })).toEqual([
    'SESSION_SECRET: required in production once a GitHub App is configured; set it, or SESSION_SECRET_FILE',
  ]);
});

test('with none of them, a token and nothing else the mode is setup, in production too', () => {
  const config = loadConfig({ ...PRODUCTION, SETUP_TOKEN: TEST_SETUP_TOKEN });
  expect(config).toMatchObject({ mode: 'setup', setupTokenIgnored: false, sessionSecret: undefined });
  expect(config.setupToken?.reveal()).toBe(TEST_SETUP_TOKEN);
  expect(config.github).toMatchObject({ appId: undefined, privateKey: undefined, clientId: undefined });
});

test('with none of them and no token, production names SETUP_TOKEN and says what to do', () => {
  expect(linesOf(PRODUCTION)).toEqual([
    'SETUP_TOKEN: required while no GitHub App is configured; set it, or set the GITHUB_* variables',
  ]);
});

test('an empty variable counts as unset: five empty App variables and a token are setup mode', () => {
  const empty = Object.fromEntries(Object.keys(FIVE).map((name) => [name, '']));
  expect(loadConfig({ ...PRODUCTION, ...empty, SETUP_TOKEN: TEST_SETUP_TOKEN }).mode).toBe('setup');
  expect(linesOf({ ...PRODUCTION, ...empty, SETUP_TOKEN: '' })).toEqual([
    'SETUP_TOKEN: required while no GitHub App is configured; set it, or set the GITHUB_* variables',
  ]);
});

test('with some of them in production the error lists every missing one, one line each, sorted', () => {
  expect(linesOf({ ...PRODUCTION, GITHUB_APP_ID: FIVE.GITHUB_APP_ID, SETUP_TOKEN: TEST_SETUP_TOKEN })).toEqual([
    'GITHUB_APP_PRIVATE_KEY: required: some GitHub App variables are set, so all five are needed (or none, for setup mode)',
    'GITHUB_CLIENT_ID: required: some GitHub App variables are set, so all five are needed (or none, for setup mode)',
    'GITHUB_CLIENT_SECRET: required: some GitHub App variables are set, so all five are needed (or none, for setup mode)',
    'GITHUB_WEBHOOK_SECRET: required: some GitHub App variables are set, so all five are needed (or none, for setup mode)',
  ]);
});

test('a SETUP_TOKEN while the App is configured is ignored: it is not kept, and the config says it was dropped', () => {
  const config = loadConfig({
    ...PRODUCTION,
    ...FIVE,
    SESSION_SECRET: AUTH_ENV['SESSION_SECRET'],
    SETUP_TOKEN: TEST_SETUP_TOKEN,
  });
  expect(config).toMatchObject({ mode: 'normal', setupToken: undefined, setupTokenIgnored: true });
});

test.each([
  ['31 characters', 31, false],
  ['32 characters', 32, true],
  ['64 characters', 64, true],
])('a SETUP_TOKEN of %s is %s', (_label, length, accepted) => {
  const env = { ...PRODUCTION, SETUP_TOKEN: 't'.repeat(length) };
  if (accepted) {
    expect(loadConfig(env).setupToken?.reveal()).toBe('t'.repeat(length));
  } else {
    expect(linesOf(env)).toEqual(['SETUP_TOKEN: must be at least 32 characters']);
  }
});

test('a short SETUP_TOKEN is refused even while the App is configured, and the token is not in the error', () => {
  const lines = linesOf({
    ...PRODUCTION,
    ...FIVE,
    SESSION_SECRET: AUTH_ENV['SESSION_SECRET'],
    SETUP_TOKEN: 'short-token-LEAK',
  });
  expect(lines).toEqual(['SETUP_TOKEN: must be at least 32 characters']);
});

test('outside production an App that is missing parts, or missing altogether, is not an error', () => {
  expect(loadConfig({ DATABASE_URL: SAMPLE_DATABASE_URL })).toMatchObject({ mode: 'normal', setupToken: undefined });
  expect(loadConfig({ DATABASE_URL: SAMPLE_DATABASE_URL, GITHUB_APP_ID: '1' }).mode).toBe('normal');
  expect(loadConfig({ DATABASE_URL: SAMPLE_DATABASE_URL, ...AUTH_ENV }).mode).toBe('normal');
});

test('outside production a token and no App is setup mode, so a developer can try the first-run flow', () => {
  const config = loadConfig({ DATABASE_URL: SAMPLE_DATABASE_URL, SETUP_TOKEN: TEST_SETUP_TOKEN });
  expect(config).toMatchObject({ mode: 'setup', setupTokenIgnored: false });
});

test('the error names every invalid variable at once, one line each, in the form VARIABLE: rule', () => {
  const lines = linesOf({
    DATABASE_URL: 'mysql://admin:hunter2@h/db',
    PORT: '99999',
    LOG_LEVEL: 'shouting',
    PUBLIC_BASE_URL: 'https://cla.example.org/path',
    SOURCE_URL: 'http://example.org',
    SOURCE_COMMIT: 'not-a-commit',
  });
  expect(lines).toEqual([
    'DATABASE_URL: must be a postgres:// or postgresql:// connection string (required; set it, or DATABASE_URL_FILE)',
    'LOG_LEVEL: must be one of fatal, error, warn, info, debug, trace, silent',
    'PORT: must be a whole number from 0 to 65535 (digits only)',
    'PUBLIC_BASE_URL: must be an origin such as https://cla.example.com (scheme and host only); https is required when NODE_ENV=production',
    'SOURCE_COMMIT: must be a 40 character lower case hexadecimal commit id, or empty, or unknown',
    'SOURCE_URL: must be an https address without credentials, query, fragment or trailing slash',
  ]);
});

test('production over http is told the https rule on PUBLIC_BASE_URL, and a missing one is too', () => {
  const rule =
    'PUBLIC_BASE_URL: required as an https origin when NODE_ENV=production (for example https://cla.example.com)';
  const setup = { SETUP_TOKEN: TEST_SETUP_TOKEN };
  expect(linesOf({ ...PRODUCTION, ...setup, PUBLIC_BASE_URL: 'http://cla.example.org' })).toEqual([rule]);
  expect(linesOf({ ...PRODUCTION, ...setup, PUBLIC_BASE_URL: undefined })).toEqual([rule]);
});

test('a ConfigError is its lines, and carries the issues and the variables', () => {
  const error = new ConfigError([
    { variable: 'A', rule: 'must be set' },
    { variable: 'B, B_FILE', rule: 'set only one' },
  ]);
  expect(error.message).toBe('A: must be set\nB, B_FILE: set only one');
  expect(error.lines).toEqual(['A: must be set', 'B, B_FILE: set only one']);
  expect(error.variables).toEqual(['A', 'B, B_FILE']);
  expect(error.issues).toHaveLength(2);
  expect(error.name).toBe('ConfigError');
});
