// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { inspect } from 'node:util';
import { expect, test } from 'vitest';
import { ConfigError, loadConfig } from './env.ts';
import { MASK, Secret } from './secret.ts';
import { TEST_WEBHOOK_SECRET, testRsaKey } from './test-support.ts';

const DB = 'postgres://cla_app:s3cr3t-pw@db.internal:5432/cla';
const CURRENT = 'current-webhook-secret-0001';
const PREVIOUS = 'previous-webhook-secret-002';
const PRODUCTION = {
  NODE_ENV: 'production',
  PUBLIC_BASE_URL: 'https://cla.example.org',
  GITHUB_APP_ID: '12345',
  GITHUB_APP_PRIVATE_KEY: testRsaKey().pkcs8,
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

test('the webhook secrets are read as Secret values, the previous one apart from the current one', () => {
  const { github } = loadConfig({
    DATABASE_URL: DB,
    GITHUB_WEBHOOK_SECRET: CURRENT,
    GITHUB_WEBHOOK_SECRET_PREVIOUS: PREVIOUS,
  });
  expect(github.webhookSecret).toBeInstanceOf(Secret);
  expect(github.webhookSecret?.reveal()).toBe(CURRENT);
  expect(github.previousWebhookSecret).toBeInstanceOf(Secret);
  expect(github.previousWebhookSecret?.reveal()).toBe(PREVIOUS);
});

test('neither webhook secret is required outside production, and the previous one is always optional', () => {
  const { github } = loadConfig({ DATABASE_URL: DB });
  expect(github.webhookSecret).toBeUndefined();
  expect(github.previousWebhookSecret).toBeUndefined();
  expect(loadConfig({ DATABASE_URL: DB, NODE_ENV: 'test' }).github.webhookSecret).toBeUndefined();
  expect(loadConfig({ DATABASE_URL: DB, ...PRODUCTION, GITHUB_WEBHOOK_SECRET: CURRENT }).github).toMatchObject({
    previousWebhookSecret: undefined,
  });
});

test.each([
  ['missing', {}],
  ['empty', { GITHUB_WEBHOOK_SECRET: '' }],
])('production with the secret %s is a ConfigError naming only GITHUB_WEBHOOK_SECRET', (_label, given) => {
  expect(capture({ ...PRODUCTION, ...given }).variables).toEqual(['GITHUB_WEBHOOK_SECRET']);
});

test('production with the secret set is accepted', () => {
  const { github } = loadConfig({ DATABASE_URL: DB, ...PRODUCTION, GITHUB_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET });
  expect(github.webhookSecret?.reveal()).toBe(TEST_WEBHOOK_SECRET);
});

test.each([
  ['the secret', 'GITHUB_WEBHOOK_SECRET', ['GITHUB_WEBHOOK_SECRET']],
  ['the previous secret', 'GITHUB_WEBHOOK_SECRET_PREVIOUS', ['GITHUB_WEBHOOK_SECRET_PREVIOUS']],
])('%s of 15 characters is refused by name and 16 are accepted', (_label, name, names) => {
  const others = { GITHUB_WEBHOOK_SECRET: CURRENT };
  expect(capture({ ...others, [name]: 'x'.repeat(15) }).variables).toEqual(names);
  expect(() => loadConfig({ DATABASE_URL: DB, ...others, [name]: `${'y'.repeat(15)}z` })).not.toThrow();
});

test('a previous secret equal to the current one is a ConfigError naming the previous variable only', () => {
  const error = capture({ GITHUB_WEBHOOK_SECRET: CURRENT, GITHUB_WEBHOOK_SECRET_PREVIOUS: CURRENT });
  expect(error.variables).toEqual(['GITHUB_WEBHOOK_SECRET_PREVIOUS']);
  expect(error.message).toBe('Invalid environment configuration: GITHUB_WEBHOOK_SECRET_PREVIOUS');
  expect(error.message).not.toContain(CURRENT);
});

test('a previous secret that differs in one character from the current one is accepted', () => {
  expect(() =>
    loadConfig({
      DATABASE_URL: DB,
      GITHUB_WEBHOOK_SECRET: CURRENT,
      GITHUB_WEBHOOK_SECRET_PREVIOUS: `${CURRENT.slice(0, -1)}2`,
    }),
  ).not.toThrow();
});

test('an empty previous secret counts as unset', () => {
  const { github } = loadConfig({
    DATABASE_URL: DB,
    GITHUB_WEBHOOK_SECRET: CURRENT,
    GITHUB_WEBHOOK_SECRET_PREVIOUS: '',
  });
  expect(github.previousWebhookSecret).toBeUndefined();
});

test('the invalid-secret error never carries a value', () => {
  const error = capture({ GITHUB_WEBHOOK_SECRET: 'too-short', GITHUB_WEBHOOK_SECRET_PREVIOUS: 'tiny-previous' });
  expect(error.variables).toEqual(['GITHUB_WEBHOOK_SECRET', 'GITHUB_WEBHOOK_SECRET_PREVIOUS']);
  expect(error.message).not.toMatch(/too-short|tiny-previous/);
});

test('neither webhook secret can be printed from the loaded configuration', () => {
  const config = loadConfig({
    DATABASE_URL: DB,
    GITHUB_WEBHOOK_SECRET: CURRENT,
    GITHUB_WEBHOOK_SECRET_PREVIOUS: PREVIOUS,
  });
  for (const printed of [JSON.stringify(config), inspect(config, { depth: 6 }), String(config.github.webhookSecret)]) {
    expect(printed).not.toContain(CURRENT);
    expect(printed).not.toContain(PREVIOUS);
  }
  expect(JSON.stringify(config.github)).toContain(MASK);
});
