// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { inspect } from 'node:util';
import { expect, test } from 'vitest';
import { ConfigError, loadConfig } from './env.ts';
import { publicKeyFingerprint } from './github-key.ts';
import { MASK } from './secret.ts';
import { escapeNewlines, TEST_WEBHOOK_SECRET, testRsaKey, testUnsuitableKeys } from './test-support.ts';

const DB = 'postgres://cla_app:s3cr3t-pw@db.internal:5432/cla';
const KEY = testRsaKey();
const OTHER = testRsaKey();
const PRODUCTION = {
  NODE_ENV: 'production',
  PUBLIC_BASE_URL: 'https://cla.example.org',
  GITHUB_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
};
const UNSUITABLE = testUnsuitableKeys();

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
  ['missing', { ...PRODUCTION, GITHUB_APP_PRIVATE_KEY: KEY.pkcs8 }, ['GITHUB_APP_ID']],
  ['empty', { ...PRODUCTION, GITHUB_APP_PRIVATE_KEY: KEY.pkcs8, GITHUB_APP_ID: '' }, ['GITHUB_APP_ID']],
  ['not numeric', { ...PRODUCTION, GITHUB_APP_PRIVATE_KEY: KEY.pkcs8, GITHUB_APP_ID: 'abc' }, ['GITHUB_APP_ID']],
  ['negative', { GITHUB_APP_ID: '-5' }, ['GITHUB_APP_ID']],
  ['a decimal', { GITHUB_APP_ID: '1.5' }, ['GITHUB_APP_ID']],
  ['with a space', { GITHUB_APP_ID: '12 34' }, ['GITHUB_APP_ID']],
  ['with a trailing newline', { GITHUB_APP_ID: '1234\n' }, ['GITHUB_APP_ID']],
  ['21 digits long', { GITHUB_APP_ID: '1'.repeat(21) }, ['GITHUB_APP_ID']],
])('an App id that is %s is reported by name', (_label, env, names) => {
  expect(capture({ ...env }).variables).toEqual(names);
});

test('a 20 digit App id is accepted', () => {
  expect(loadConfig({ DATABASE_URL: DB, GITHUB_APP_ID: '9'.repeat(20) }).github.appId).toBe('9'.repeat(20));
});

test.each([
  ['the App id', { GITHUB_APP_PRIVATE_KEY: KEY.pkcs8 }, ['GITHUB_APP_ID']],
  ['the key', { GITHUB_APP_ID: '12345' }, ['GITHUB_APP_PRIVATE_KEY']],
  ['both', {}, ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY']],
])('production without %s is a ConfigError naming only what is missing', (_label, given, names) => {
  expect(capture({ ...PRODUCTION, ...given }).variables).toEqual(names);
});

test.each([
  ['development', {}],
  ['test', { NODE_ENV: 'test' }],
  ['development with only the id', { GITHUB_APP_ID: '12345' }],
  ['test with only the key', { NODE_ENV: 'test', GITHUB_APP_PRIVATE_KEY: KEY.pkcs8 }],
])('outside production the App id and the key stay optional: %s starts without them', (_label, env) => {
  expect(() => loadConfig({ DATABASE_URL: DB, ...env })).not.toThrow();
});

test('production accepts the id and the key, and the previous key stays optional', () => {
  const { github } = loadConfig({
    DATABASE_URL: DB,
    ...PRODUCTION,
    GITHUB_APP_ID: '12345',
    GITHUB_APP_PRIVATE_KEY: KEY.pkcs8,
  });
  expect(github.appId).toBe('12345');
  expect(github.privateKey?.fingerprint).toBe(publicKeyFingerprint(KEY.publicKey));
  expect(github.previousPrivateKey).toBeUndefined();
});

test.each([
  ['PKCS#1', KEY.pkcs1],
  ['PKCS#8', KEY.pkcs8],
  ['PKCS#1 with escaped newlines', escapeNewlines(KEY.pkcs1)],
  ['PKCS#8 with escaped newlines', escapeNewlines(KEY.pkcs8)],
])('a %s key is accepted as the current and as the previous key', (_label, pem) => {
  const current = loadConfig({ DATABASE_URL: DB, GITHUB_APP_PRIVATE_KEY: pem }).github;
  const previous = loadConfig({
    DATABASE_URL: DB,
    GITHUB_APP_PRIVATE_KEY: OTHER.pkcs8,
    GITHUB_APP_PRIVATE_KEY_PREVIOUS: pem,
  }).github;
  expect(current.privateKey?.fingerprint).toBe(publicKeyFingerprint(KEY.publicKey));
  expect(previous.previousPrivateKey?.fingerprint).toBe(publicKeyFingerprint(KEY.publicKey));
  expect(previous.privateKey?.fingerprint).toBe(publicKeyFingerprint(OTHER.publicKey));
});

test.each([
  ['a key of 1024 bits', testRsaKey(1024).pkcs8],
  ['a truncated PEM', KEY.pkcs8.slice(0, 200)],
  ['text that is not a key', 'not a key'],
  ...Object.entries(UNSUITABLE),
])('%s is reported by variable name, as the current and as the previous key', (_label, pem) => {
  expect(capture({ GITHUB_APP_PRIVATE_KEY: pem }).variables).toEqual(['GITHUB_APP_PRIVATE_KEY']);
  expect(capture({ GITHUB_APP_PRIVATE_KEY: KEY.pkcs8, GITHUB_APP_PRIVATE_KEY_PREVIOUS: pem }).variables).toEqual([
    'GITHUB_APP_PRIVATE_KEY_PREVIOUS',
  ]);
});

test.each([
  ['the same text', KEY.pkcs8, KEY.pkcs8],
  ['the same key as PKCS#1 and PKCS#8', KEY.pkcs8, KEY.pkcs1],
  ['the same key with escaped newlines', KEY.pkcs1, escapeNewlines(KEY.pkcs1)],
])('a previous key equal to the current one (%s) is a ConfigError naming only the previous variable', (_l, a, b) => {
  const error = capture({ GITHUB_APP_PRIVATE_KEY: a, GITHUB_APP_PRIVATE_KEY_PREVIOUS: b });
  expect(error.variables).toEqual(['GITHUB_APP_PRIVATE_KEY_PREVIOUS']);
  expect(error.message).toBe('Invalid environment configuration: GITHUB_APP_PRIVATE_KEY_PREVIOUS');
});

test('a ConfigError about a key never holds any of its text', () => {
  const body = KEY.pkcs8.split('\n')[1] ?? 'missing';
  const errors = [
    capture({ GITHUB_APP_PRIVATE_KEY: KEY.pkcs8.slice(0, 300) }),
    capture({ GITHUB_APP_PRIVATE_KEY: KEY.pkcs8, GITHUB_APP_PRIVATE_KEY_PREVIOUS: KEY.pkcs1 }),
    capture({ GITHUB_APP_PRIVATE_KEY: escapeNewlines(testRsaKey(1024).pkcs1) }),
  ];
  for (const error of errors) {
    const printed = `${error.message} ${inspect(error, { depth: 6 })}`;
    expect(printed).not.toContain(body);
    expect(printed).not.toContain('PRIVATE KEY');
    expect(printed).not.toContain('BEGIN');
  }
});

test('the keys in the loaded config print as the mask in every way, and the fingerprint does not leak the key', () => {
  const { github } = loadConfig({
    DATABASE_URL: DB,
    GITHUB_APP_ID: '12345',
    GITHUB_APP_PRIVATE_KEY: KEY.pkcs8,
    GITHUB_APP_PRIVATE_KEY_PREVIOUS: OTHER.pkcs1,
  });
  const body = KEY.pkcs8.split('\n')[1] ?? 'missing';
  const otherBody = OTHER.pkcs1.split('\n')[1] ?? 'missing';
  for (const printed of [JSON.stringify(github), inspect(github, { depth: 6 }), String(github.privateKey?.pem)]) {
    expect(printed).not.toContain(body);
    expect(printed).not.toContain(otherBody);
    expect(printed).not.toContain('PRIVATE KEY');
    expect(printed).toContain(MASK);
  }
  expect(JSON.stringify(github)).toContain(publicKeyFingerprint(KEY.publicKey));
  expect(github.privateKey?.pem.reveal()).toBe(KEY.pkcs8.trim());
  expect(github.previousPrivateKey?.pem.reveal()).toBe(OTHER.pkcs1.trim());
});
