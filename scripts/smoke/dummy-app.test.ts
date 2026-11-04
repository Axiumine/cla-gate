// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { loadConfig } from '../../src/server/config/env.ts';
import { dummyApp } from './dummy-app.ts';

// E19-S12: the made-up App of the configured-mode scenario is one the application accepts as configured.

/** Random hex from a counter, so that two calls differ and a test can predict the first. */
function counter(): (bytes: number) => string {
  let next = 0;
  return (bytes) => {
    next += 1;
    return next.toString(16).padStart(2, '0').repeat(bytes);
  };
}

/** The environment the compose stack gives the application once the files are in place: the files' content under the variable names. */
function environment(app: ReturnType<typeof dummyApp>): Record<string, string> {
  return {
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: 'https://localhost',
    DATABASE_URL: 'postgres://cla_app:made-up@postgres:5432/cla',
    SESSION_SECRET: 'a'.repeat(64),
    SETUP_TOKEN: 'b'.repeat(64),
    GITHUB_APP_ID: app.settings['GITHUB_APP_ID'] ?? '',
    GITHUB_CLIENT_ID: app.settings['GITHUB_CLIENT_ID'] ?? '',
    GITHUB_APP_PRIVATE_KEY: app.secrets['github_app_private_key'] ?? '',
    GITHUB_WEBHOOK_SECRET: app.secrets['github_webhook_secret'] ?? '',
    GITHUB_CLIENT_SECRET: app.secrets['github_client_secret'] ?? '',
  };
}

test('the application loads the made-up values as a configured instance: all five GitHub values, mode normal', () => {
  const app = dummyApp(counter());
  const config = loadConfig(environment(app));
  expect(config.mode).toBe('normal');
  expect(String(config.github.appId)).toBe(app.settings['GITHUB_APP_ID']);
  expect(config.github.privateKey?.fingerprint).toMatch(/^SHA256:/);
  expect(config.setupTokenIgnored).toBe(true);
});

test('the settings are the App id (six digits) and a client id, and the secrets are the three files that are empty before the setup', () => {
  const app = dummyApp(counter());
  expect(Object.keys(app.settings)).toEqual(['GITHUB_APP_ID', 'GITHUB_CLIENT_ID']);
  expect(app.settings['GITHUB_APP_ID']).toMatch(/^\d{6}$/);
  expect(app.settings['GITHUB_CLIENT_ID']).toMatch(/^Iv1\.[0-9a-f]{16}$/);
  expect(Object.keys(app.secrets)).toEqual(['github_app_private_key', 'github_webhook_secret', 'github_client_secret']);
});

test('the webhook and client secrets are long enough for the application, and the key is a PEM without surrounding space', () => {
  const app = dummyApp(counter());
  expect(app.secrets['github_webhook_secret']?.length).toBeGreaterThanOrEqual(16);
  expect(app.secrets['github_client_secret']?.length).toBeGreaterThanOrEqual(16);
  const key = app.secrets['github_app_private_key'] ?? '';
  expect(key.startsWith('-----BEGIN PRIVATE KEY-----\n')).toBe(true);
  expect(key.endsWith('-----END PRIVATE KEY-----')).toBe(true);
});

test('every call makes a new key: nothing is a constant that could be in a repository', () => {
  const first = dummyApp(counter());
  const second = dummyApp(counter());
  expect(first.secrets['github_app_private_key']).not.toBe(second.secrets['github_app_private_key']);
});
