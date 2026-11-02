// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { createLogger } from '../adapters/http/logger.ts';
import { captureLogs } from '../test-support.ts';
import { authSettings, logAuth } from './auth.ts';
import { AUTH_ENV, TEST_CLIENT_ID, TEST_CLIENT_SECRET, TEST_SESSION_SECRET } from './auth-fixture/test-support.ts';
import { loadConfig } from './env.ts';

const DB = 'postgres://cla_app:s3cr3t-pw@db.internal:5432/cla';
const config = (env: Record<string, string>) => loadConfig({ DATABASE_URL: DB, ...env });

function logged(env: Record<string, string>): { lines: Record<string, unknown>[]; text: string } {
  const logs = captureLogs();
  logAuth(createLogger({ logLevel: 'info' }, logs.destination), config(env));
  return { lines: logs.lines(), text: logs.text() };
}

test('with all three settings the auth settings carry them and the lifetimes', () => {
  const settings = authSettings(config({ ...AUTH_ENV, SESSION_IDLE_SECONDS: '600', SESSION_ABSOLUTE_SECONDS: '1200' }));
  expect(settings?.sessionSecret.reveal()).toBe(TEST_SESSION_SECRET);
  expect(settings?.clientId).toBe(TEST_CLIENT_ID);
  expect(settings?.clientSecret.reveal()).toBe(TEST_CLIENT_SECRET);
  expect(settings?.session).toEqual({ idleSeconds: 600, absoluteSeconds: 1200 });
});

test.each([
  ['none', {}],
  ['no session secret', { ...AUTH_ENV, SESSION_SECRET: '' }],
  ['no client id', { ...AUTH_ENV, GITHUB_CLIENT_ID: '' }],
  ['no client secret', { ...AUTH_ENV, GITHUB_CLIENT_SECRET: '' }],
])('with %s the auth routes have no settings and are not registered', (_label, env) => {
  expect(authSettings(config(env))).toBeUndefined();
});

test('configured, start-up logs the lifetimes and nothing secret', () => {
  const { lines, text } = logged({ ...AUTH_ENV, SESSION_IDLE_SECONDS: '600', SESSION_ABSOLUTE_SECONDS: '1200' });
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ level: 30, msg: 'auth.configured', idleSeconds: 600, absoluteSeconds: 1200 });
  for (const secret of [TEST_SESSION_SECRET, TEST_CLIENT_SECRET]) {
    expect(text).not.toContain(secret);
  }
});

test('with none of the three it says so at info level, naming the variables', () => {
  const { lines } = logged({});
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({
    level: 30,
    msg: 'auth.not_configured',
    missing: ['SESSION_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
  });
});

test.each([
  ['the session secret', { ...AUTH_ENV, SESSION_SECRET: '' }, ['SESSION_SECRET']],
  ['the client id', { ...AUTH_ENV, GITHUB_CLIENT_ID: '' }, ['GITHUB_CLIENT_ID']],
  ['the client secret', { ...AUTH_ENV, GITHUB_CLIENT_SECRET: '' }, ['GITHUB_CLIENT_SECRET']],
  ['two of them', { GITHUB_CLIENT_ID: TEST_CLIENT_ID }, ['SESSION_SECRET', 'GITHUB_CLIENT_SECRET']],
])('half a configuration, without %s, is a warning', (_label, env, missing) => {
  const { lines, text } = logged(env);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ level: 40, msg: 'auth.not_configured', missing });
  expect(text).not.toContain(TEST_SESSION_SECRET);
  expect(text).not.toContain(TEST_CLIENT_SECRET);
});
