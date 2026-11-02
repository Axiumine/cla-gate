// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { inspect } from 'node:util';
import { expect, test } from 'vitest';
import { ConfigError, loadConfig, loadMigrateConfig } from './env.ts';
import { MASK, Secret } from './secret.ts';
import { testRsaKey } from './test-support.ts';

const KEY = testRsaKey();
const DB = 'postgres://cla_app:s3cr3t-pw@db.internal:5432/cla';
/** Production with the GitHub App settings it requires (E05-S01), so a row is about one variable only. */
const PRODUCTION = { NODE_ENV: 'production', GITHUB_APP_ID: '12345', GITHUB_APP_PRIVATE_KEY: KEY.pkcs8 };

function capture(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected loadConfig to throw');
}

test('a minimal environment yields the documented defaults', () => {
  const config = loadConfig({ DATABASE_URL: DB });
  expect(config).toMatchObject({
    nodeEnv: 'development',
    host: '127.0.0.1',
    port: 3000,
    logLevel: 'info',
    publicBaseUrl: 'http://localhost:3000',
    trustProxy: false,
    sessionSecret: undefined,
    github: { appId: undefined, privateKey: undefined, previousPrivateKey: undefined, webhookSecret: undefined },
  });
  expect(config.databaseUrl.reveal()).toBe(DB);
});

test('a GITHUB_APP_ID of 20 digits is accepted as text', () => {
  expect(loadConfig({ DATABASE_URL: DB, GITHUB_APP_ID: '1'.repeat(20) }).github.appId).toBe('1'.repeat(20));
});

test('every variable is read and secrets become Secret values', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    PORT: '8080',
    LOG_LEVEL: 'warn',
    DATABASE_URL: 'postgresql://u:p@h/db',
    PUBLIC_BASE_URL: 'https://cla.example.org/',
    TRUST_PROXY: '2',
    SESSION_SECRET: 's'.repeat(32),
    GITHUB_APP_ID: '12345',
    GITHUB_APP_PRIVATE_KEY: KEY.pkcs8,
    GITHUB_WEBHOOK_SECRET: 'whsec',
    GITHUB_CLIENT_ID: 'Iv1.abc',
    GITHUB_CLIENT_SECRET: 'client-secret',
  });
  expect(config).toMatchObject({
    nodeEnv: 'production',
    host: '0.0.0.0',
    port: 8080,
    logLevel: 'warn',
    publicBaseUrl: 'https://cla.example.org',
    trustProxy: 2,
    github: { appId: '12345', clientId: 'Iv1.abc' },
  });
  expect(config.sessionSecret).toBeInstanceOf(Secret);
  expect(config.github.privateKey?.pem.reveal()).toBe(KEY.pkcs8.trim());
  expect(config.github.webhookSecret?.reveal()).toBe('whsec');
  expect(config.github.clientSecret?.reveal()).toBe('client-secret');
});

test('the public base URL defaults to localhost on the configured port', () => {
  expect(loadConfig({ DATABASE_URL: DB, PORT: '4000' }).publicBaseUrl).toBe('http://localhost:4000');
});

test.each([
  ['http://localhost:8080', 'http://localhost:8080'],
  ['https://cla.example.org:8443/', 'https://cla.example.org:8443'],
])('a development PUBLIC_BASE_URL of %s is accepted as the origin %s', (given, origin) => {
  expect(loadConfig({ DATABASE_URL: DB, PUBLIC_BASE_URL: given }).publicBaseUrl).toBe(origin);
});

test('PORT 0 (an ephemeral port) is valid', () => {
  expect(loadConfig({ DATABASE_URL: DB, PORT: '0' }).port).toBe(0);
});

test('an empty variable counts as unset', () => {
  const config = loadConfig({ DATABASE_URL: DB, PORT: '', LOG_LEVEL: '', GITHUB_APP_ID: '', TRUST_PROXY: '' });
  expect(config).toMatchObject({ port: 3000, logLevel: 'info', trustProxy: false });
  expect(config.github.appId).toBeUndefined();
});

test('secrets in the loaded config cannot be printed', () => {
  const config = loadConfig({ DATABASE_URL: DB, SESSION_SECRET: 'x'.repeat(40), GITHUB_WEBHOOK_SECRET: 'whsec-bytes' });
  for (const printed of [JSON.stringify(config), inspect(config, { depth: 6 }), String(config.databaseUrl)]) {
    expect(printed).not.toContain('s3cr3t-pw');
    expect(printed).not.toContain('xxxx');
    expect(printed).not.toContain('whsec-bytes');
  }
  expect(JSON.stringify(config)).toContain(MASK);
});

test.each([
  ['a missing DATABASE_URL', { DATABASE_URL: undefined }, ['DATABASE_URL']],
  ['a non-postgres DATABASE_URL', { DATABASE_URL: 'mysql://u:p@h/db' }, ['DATABASE_URL']],
  ['a DATABASE_URL that is not a URL', { DATABASE_URL: 'not a url' }, ['DATABASE_URL']],
  ['a bad NODE_ENV', { NODE_ENV: 'staging' }, ['NODE_ENV']],
  ['a bad LOG_LEVEL', { LOG_LEVEL: 'loud' }, ['LOG_LEVEL']],
  ['a non numeric PORT', { PORT: 'http' }, ['PORT']],
  ['a PORT above 65535', { PORT: '65536' }, ['PORT']],
  ['a negative PORT', { PORT: '-1' }, ['PORT']],
  ['a bad TRUST_PROXY', { TRUST_PROXY: 'maybe' }, ['TRUST_PROXY']],
  ['a TRUST_PROXY that trusts every address', { TRUST_PROXY: '0.0.0.0/0' }, ['TRUST_PROXY']],
  ['a PUBLIC_BASE_URL with a path', { PUBLIC_BASE_URL: 'https://cla.example.org/app' }, ['PUBLIC_BASE_URL']],
  ['a PUBLIC_BASE_URL with a query', { PUBLIC_BASE_URL: 'https://cla.example.org/?x=1' }, ['PUBLIC_BASE_URL']],
  ['a PUBLIC_BASE_URL with a fragment', { PUBLIC_BASE_URL: 'https://cla.example.org/#x' }, ['PUBLIC_BASE_URL']],
  ['a PUBLIC_BASE_URL that is not http(s)', { PUBLIC_BASE_URL: 'ftp://cla.example.org' }, ['PUBLIC_BASE_URL']],
  ['a PUBLIC_BASE_URL that is not a URL', { PUBLIC_BASE_URL: 'cla.example.org' }, ['PUBLIC_BASE_URL']],
  ['a short SESSION_SECRET', { SESSION_SECRET: 'short' }, ['SESSION_SECRET']],
  ['a non numeric GITHUB_APP_ID', { GITHUB_APP_ID: 'abc' }, ['GITHUB_APP_ID']],
  ['a GITHUB_APP_ID that ends in letters', { GITHUB_APP_ID: '123abc' }, ['GITHUB_APP_ID']],
  ['a GITHUB_APP_ID that starts with letters', { GITHUB_APP_ID: 'abc123' }, ['GITHUB_APP_ID']],
  ['a GITHUB_APP_ID of 21 digits', { GITHUB_APP_ID: '1'.repeat(21) }, ['GITHUB_APP_ID']],
  ['a PORT with trailing text', { PORT: '8080 ' }, ['PORT']],
  ['a PORT in exponent notation', { PORT: '1e3' }, ['PORT']],
  ['a PORT in hexadecimal', { PORT: '0x50' }, ['PORT']],
  ['a PORT of six digits', { PORT: '000080' }, ['PORT']],
  ['production over http', { ...PRODUCTION, PUBLIC_BASE_URL: 'http://cla.example.org' }, ['PUBLIC_BASE_URL']],
  ['production without PUBLIC_BASE_URL', { ...PRODUCTION, PUBLIC_BASE_URL: undefined }, ['PUBLIC_BASE_URL']],
])('%s is reported by name', (_label, extra, names) => {
  expect(capture({ DATABASE_URL: DB, ...extra }).variables).toEqual(names);
});

test('the error lists every invalid name, sorted, and never a value', () => {
  const error = capture({
    DATABASE_URL: 'mysql://admin:hunter2@h/db',
    PORT: '99999',
    LOG_LEVEL: 'shouting',
    TRUST_PROXY: 'maybe',
    SESSION_SECRET: 'tiny',
  });
  expect(error.variables).toEqual(['DATABASE_URL', 'LOG_LEVEL', 'PORT', 'SESSION_SECRET', 'TRUST_PROXY']);
  expect(error.message).toBe(
    'Invalid environment configuration: DATABASE_URL, LOG_LEVEL, PORT, SESSION_SECRET, TRUST_PROXY',
  );
  expect(error.name).toBe('ConfigError');
  for (const value of ['hunter2', 'mysql', '99999', 'shouting', 'maybe', 'tiny']) {
    expect(error.message).not.toContain(value);
  }
});

test('migrate config prefers MIGRATION_DATABASE_URL and falls back to DATABASE_URL', () => {
  const owner = 'postgres://owner:pw@h/db';
  expect(loadMigrateConfig({ MIGRATION_DATABASE_URL: owner, DATABASE_URL: DB }).databaseUrl.reveal()).toBe(owner);
  expect(loadMigrateConfig({ DATABASE_URL: DB }).databaseUrl.reveal()).toBe(DB);
  expect(loadMigrateConfig({ MIGRATION_DATABASE_URL: '', DATABASE_URL: DB }).databaseUrl.reveal()).toBe(DB);
});

test.each([
  ['unset', {}],
  ['empty', { MIGRATION_DATABASE_URL: '' }],
])('in production the owner connection is required: MIGRATION_DATABASE_URL %s is an error', (_label, extra) => {
  const env = { NODE_ENV: 'production', DATABASE_URL: DB, ...extra };
  expect(() => loadMigrateConfig(env)).toThrow(new ConfigError(['MIGRATION_DATABASE_URL']));
  const owner = 'postgres://owner:pw@h/db';
  expect(loadMigrateConfig({ ...env, MIGRATION_DATABASE_URL: owner }).databaseUrl.reveal()).toBe(owner);
});

test.each([
  ['nothing is set', {}, 'DATABASE_URL'],
  ['DATABASE_URL is invalid', { DATABASE_URL: 'nope' }, 'DATABASE_URL'],
  ['MIGRATION_DATABASE_URL is invalid', { MIGRATION_DATABASE_URL: 'nope', DATABASE_URL: DB }, 'MIGRATION_DATABASE_URL'],
])('migrate config names the offending variable when %s', (_label, env, name) => {
  expect(() => loadMigrateConfig(env)).toThrow(new ConfigError([name]));
});
