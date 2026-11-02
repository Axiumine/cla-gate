// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { createLogger } from '../adapters/http/logger.ts';
import { captureLogs } from '../test-support.ts';
import { loadConfig } from './env.ts';
import { logGithubApp } from './github-app.ts';
import { publicKeyFingerprint } from './github-key.ts';
import { testRsaKey } from './test-support.ts';

const DB = 'postgres://cla_app:s3cr3t-pw@db.internal:5432/cla';
const KEY = testRsaKey();
const PREVIOUS = testRsaKey();

function logged(env: Record<string, string>): { lines: Record<string, unknown>[]; text: string } {
  const logs = captureLogs();
  logGithubApp(createLogger({ logLevel: 'info' }, logs.destination), loadConfig({ DATABASE_URL: DB, ...env }).github);
  return { lines: logs.lines(), text: logs.text() };
}

test('with the App id and a key it logs the id and the fingerprint, never the key', () => {
  const { lines, text } = logged({ GITHUB_APP_ID: '12345', GITHUB_APP_PRIVATE_KEY: KEY.pkcs8 });
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({
    level: 30,
    msg: 'github.app_configured',
    appId: '12345',
    keyFingerprints: [publicKeyFingerprint(KEY.publicKey)],
  });
  expect(text).not.toContain('PRIVATE KEY');
  expect(text).not.toContain(KEY.pkcs8.split('\n')[1] ?? 'missing');
});

test('during a rotation it logs the fingerprints in signing order: current, then previous', () => {
  const { lines, text } = logged({
    GITHUB_APP_ID: '12345',
    GITHUB_APP_PRIVATE_KEY: KEY.pkcs1,
    GITHUB_APP_PRIVATE_KEY_PREVIOUS: PREVIOUS.pkcs8,
  });
  expect(lines[0]).toMatchObject({
    msg: 'github.app_configured',
    keyFingerprints: [publicKeyFingerprint(KEY.publicKey), publicKeyFingerprint(PREVIOUS.publicKey)],
  });
  expect(text).not.toContain(PREVIOUS.pkcs8.split('\n')[1] ?? 'missing');
});

test('without any GitHub credentials it says so at info level and names nothing but the variables', () => {
  const { lines } = logged({});
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({
    level: 30,
    msg: 'github.app_not_configured',
    missing: ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY'],
  });
});

test.each([
  ['the key', { GITHUB_APP_ID: '12345' }, ['GITHUB_APP_PRIVATE_KEY']],
  ['the App id', { GITHUB_APP_PRIVATE_KEY: KEY.pkcs8 }, ['GITHUB_APP_ID']],
])('half a configuration, without %s, is a warning: the adapter is not built', (_label, env, missing) => {
  const { lines, text } = logged(env);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ level: 40, msg: 'github.app_not_configured', missing });
  expect(text).not.toContain('PRIVATE KEY');
});

test('a previous key alone does not make a configuration', () => {
  const { lines } = logged({ GITHUB_APP_ID: '12345', GITHUB_APP_PRIVATE_KEY_PREVIOUS: PREVIOUS.pkcs8 });
  expect(lines[0]).toMatchObject({ msg: 'github.app_not_configured', missing: ['GITHUB_APP_PRIVATE_KEY'] });
});
