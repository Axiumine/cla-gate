// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { AUTH_ENV, TEST_CLIENT_ID, TEST_CLIENT_SECRET, TEST_SESSION_SECRET } from './auth-fixture/test-support.ts';
import { ConfigError } from './config-error.ts';
import { loadConfig } from './env.ts';
import { TEST_WEBHOOK_SECRET, testRsaKey } from './test-support.ts';

// The login settings of E10-S01: three secrets that production requires, two session lifetimes.

const DB = 'postgres://cla_app:s3cr3t-pw@db.internal:5432/cla';
const PRODUCTION = {
  NODE_ENV: 'production',
  PUBLIC_BASE_URL: 'https://cla.example.org',
  GITHUB_APP_ID: '12345',
  GITHUB_APP_PRIVATE_KEY: testRsaKey().pkcs8,
  GITHUB_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
};

function capture(env: Record<string, string | undefined>): ConfigError {
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
  ['unset', { ...AUTH_ENV, SESSION_SECRET: undefined }],
  ['empty', { ...AUTH_ENV, SESSION_SECRET: '' }],
])(
  'production with the GitHub App and a session secret that is %s is a ConfigError naming only SESSION_SECRET',
  (_label, auth) => {
    const error = capture({ ...PRODUCTION, ...auth });
    expect(error.lines).toEqual([
      'SESSION_SECRET: required in production once a GitHub App is configured; set it, or SESSION_SECRET_FILE',
    ]);
  },
);

test.each([
  ['GITHUB_CLIENT_ID', { ...AUTH_ENV, GITHUB_CLIENT_ID: undefined }],
  ['GITHUB_CLIENT_SECRET', { ...AUTH_ENV, GITHUB_CLIENT_SECRET: undefined }],
])('production without %s names it, as a missing part of the GitHub App', (name, auth) => {
  const error = capture({ ...PRODUCTION, ...auth });
  expect(error.lines).toEqual([
    `${name}: required: some GitHub App variables are set, so all five are needed (or none, for setup mode)`,
  ]);
});

test('production in setup mode (no GitHub App, a setup token) needs no session secret, client id or client secret', () => {
  const env = { NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://cla.example.org', SETUP_TOKEN: 'x'.repeat(32) };
  const config = loadConfig({ DATABASE_URL: DB, ...env });
  expect(config).toMatchObject({ mode: 'setup', sessionSecret: undefined });
});

test('a session secret under 32 characters is refused by name in every environment, and its value is never reported', () => {
  const error = capture({ ...AUTH_ENV, SESSION_SECRET: 'recognisable-short-secret' });
  expect(error.variables).toEqual(['SESSION_SECRET']);
  expect(error.message).not.toContain('recognisable-short-secret');
});

test.each([
  ['development', {}],
  ['test', { NODE_ENV: 'test' }],
  ['development with one of the three', { SESSION_SECRET: TEST_SESSION_SECRET }],
  ['test with two of the three', { NODE_ENV: 'test', GITHUB_CLIENT_ID: TEST_CLIENT_ID, GITHUB_CLIENT_SECRET: 'x' }],
])('outside production the three stay optional: %s starts without them', (_label, env) => {
  expect(() => loadConfig({ DATABASE_URL: DB, ...env })).not.toThrow();
});

test('production accepts the three, and the secrets become Secret values', () => {
  const config = loadConfig({ DATABASE_URL: DB, ...PRODUCTION, ...AUTH_ENV });
  expect(config.sessionSecret?.reveal()).toBe(TEST_SESSION_SECRET);
  expect(config.github.clientId).toBe(TEST_CLIENT_ID);
  expect(config.github.clientSecret?.reveal()).toBe(TEST_CLIENT_SECRET);
  expect(JSON.stringify(config)).not.toContain(TEST_CLIENT_SECRET);
  expect(JSON.stringify(config)).not.toContain(TEST_SESSION_SECRET);
});

test('the lifetimes default to 8 hours idle and 7 days absolute', () => {
  expect(loadConfig({ DATABASE_URL: DB }).session).toEqual({ idleSeconds: 28_800, absoluteSeconds: 604_800 });
});

test('empty lifetimes count as unset', () => {
  const env = { DATABASE_URL: DB, SESSION_IDLE_SECONDS: '', SESSION_ABSOLUTE_SECONDS: '' };
  expect(loadConfig(env).session).toEqual({ idleSeconds: 28_800, absoluteSeconds: 604_800 });
});

test.each([
  ['both given', { SESSION_IDLE_SECONDS: '3600', SESSION_ABSOLUTE_SECONDS: '86400' }, [3600, 86_400]],
  ['the minimum of 300 for both', { SESSION_IDLE_SECONDS: '300', SESSION_ABSOLUTE_SECONDS: '300' }, [300, 300]],
  ['idle equal to absolute', { SESSION_IDLE_SECONDS: '5000', SESSION_ABSOLUTE_SECONDS: '5000' }, [5000, 5000]],
  ['only idle, below the default absolute', { SESSION_IDLE_SECONDS: '604800' }, [604_800, 604_800]],
  ['only absolute, above the default idle', { SESSION_ABSOLUTE_SECONDS: '28800' }, [28_800, 28_800]],
  ['nine digits', { SESSION_IDLE_SECONDS: '300', SESSION_ABSOLUTE_SECONDS: '999999999' }, [300, 999_999_999]],
])('lifetimes are read: %s', (_label, env, [idle, absolute]) => {
  expect(loadConfig({ DATABASE_URL: DB, ...env }).session).toEqual({ idleSeconds: idle, absoluteSeconds: absolute });
});

test.each([
  ['idle below 300', { SESSION_IDLE_SECONDS: '299' }, ['SESSION_IDLE_SECONDS']],
  [
    'absolute below 300',
    { SESSION_ABSOLUTE_SECONDS: '299', SESSION_IDLE_SECONDS: '300' },
    ['SESSION_ABSOLUTE_SECONDS'],
  ],
  ['zero', { SESSION_IDLE_SECONDS: '0' }, ['SESSION_IDLE_SECONDS']],
  ['a negative number', { SESSION_IDLE_SECONDS: '-3600' }, ['SESSION_IDLE_SECONDS']],
  ['a decimal', { SESSION_ABSOLUTE_SECONDS: '3600.5' }, ['SESSION_ABSOLUTE_SECONDS']],
  ['exponent notation', { SESSION_ABSOLUTE_SECONDS: '1e5' }, ['SESSION_ABSOLUTE_SECONDS']],
  ['hexadecimal', { SESSION_IDLE_SECONDS: '0x12c' }, ['SESSION_IDLE_SECONDS']],
  ['text', { SESSION_IDLE_SECONDS: 'eight hours' }, ['SESSION_IDLE_SECONDS']],
  ['surrounding spaces', { SESSION_IDLE_SECONDS: ' 3600 ' }, ['SESSION_IDLE_SECONDS']],
  ['ten digits', { SESSION_ABSOLUTE_SECONDS: '1000000000' }, ['SESSION_ABSOLUTE_SECONDS']],
  [
    'idle above the default absolute',
    { SESSION_IDLE_SECONDS: '604801' },
    ['SESSION_ABSOLUTE_SECONDS', 'SESSION_IDLE_SECONDS'],
  ],
  [
    'absolute below the default idle',
    { SESSION_ABSOLUTE_SECONDS: '28799' },
    ['SESSION_ABSOLUTE_SECONDS', 'SESSION_IDLE_SECONDS'],
  ],
  [
    'idle one second above absolute',
    { SESSION_IDLE_SECONDS: '5001', SESSION_ABSOLUTE_SECONDS: '5000' },
    ['SESSION_ABSOLUTE_SECONDS', 'SESSION_IDLE_SECONDS'],
  ],
])('a lifetime with %s is reported by name', (_label, env, names) => {
  const error = capture(env);
  expect(error.variables).toEqual(names);
  // The rules quote limits (300, 999999999), so only a value of four characters or more can be told from them.
  for (const value of Object.values(env).filter((given) => given.length >= 4)) {
    expect(error.message).not.toContain(value);
  }
});
