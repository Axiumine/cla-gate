// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, onTestFinished, test } from 'vitest';
import { openPgliteDatabase } from './adapters/db/pglite.ts';
import { createLogger } from './adapters/http/logger.ts';
import { boot } from './boot.ts';
import { logConfiguration } from './config/mode-log.ts';
import { TEST_SETUP_TOKEN } from './config/test-support.ts';
import {
  captureLogs,
  FakeProcess,
  freePort,
  startFakeJobQueue,
  testConfig,
  UNREACHABLE_DATABASE_URL,
} from './test-support.ts';

// E19-S02: the server says which mode it runs in. Setup mode needs a token and never starts without one; a token that is
// set while the GitHub App is configured is ignored, with a warning that names the variable and never its value.

async function start(env: Record<string, string>) {
  const logs = captureLogs();
  const errors: string[] = [];
  const signals = new FakeProcess();
  const db = await openPgliteDatabase();
  const server = await boot({
    env: { DATABASE_URL: UNREACHABLE_DATABASE_URL, HOST: '127.0.0.1', PORT: String(await freePort()), ...env },
    signals,
    createDb: () => db,
    createJobQueue: startFakeJobQueue,
    logDestination: logs.destination,
    err: (line) => errors.push(line),
    reconcileOnStart: false,
  });
  onTestFinished(async () => {
    await server?.close();
    if (server === undefined) {
      await db.destroy();
    }
  });
  return { server, logs, errors, signals };
}

const PRODUCTION = { NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://cla.example.org', LOG_LEVEL: 'info' };

test('production with no GitHub App and a setup token starts in setup mode, healthy, and never logs the token', async () => {
  const { server, logs } = await start({ ...PRODUCTION, SETUP_TOKEN: TEST_SETUP_TOKEN });
  expect((await fetch(`${server?.address}/healthz`)).status).toBe(200);
  expect((await fetch(`${server?.address}/readyz`)).status).toBe(200);
  expect(logs.lines().find((line) => line['msg'] === 'config.mode')).toMatchObject({ level: 30, mode: 'setup' });
  expect(logs.lines().some((line) => line['level'] === 40)).toBe(false);
  expect(logs.text()).not.toContain(TEST_SETUP_TOKEN);
});

test('production with no GitHub App and no setup token does not start, and says which variable to set', async () => {
  const { server, errors, signals, logs } = await start(PRODUCTION);
  expect(server).toBeUndefined();
  expect(signals.exitCode).toBe(1);
  expect(errors).toEqual([
    'SETUP_TOKEN: required while no GitHub App is configured; set it, or set the GITHUB_* variables',
  ]);
  expect(logs.text()).toBe('');
});

test('a setup token while the App is configured is ignored with a warning that names SETUP_TOKEN and not its value', async () => {
  // Development, with the client id only: the mode is normal without any call to GitHub, which is all this test needs.
  const { server, logs } = await start({
    LOG_LEVEL: 'info',
    GITHUB_CLIENT_ID: 'Iv1.made-up',
    SETUP_TOKEN: TEST_SETUP_TOKEN,
  });
  expect((await fetch(`${server?.address}/healthz`)).status).toBe(200);
  const lines = logs.lines();
  expect(lines.find((line) => line['msg'] === 'config.mode')).toMatchObject({ level: 30, mode: 'normal' });
  const warning = lines.find((line) => line['variable'] === 'SETUP_TOKEN');
  expect(warning).toMatchObject({
    level: 40,
    variable: 'SETUP_TOKEN',
    msg: 'SETUP_TOKEN is ignored while a GitHub App is configured; remove it',
  });
  expect(logs.text()).not.toContain(TEST_SETUP_TOKEN);
});

test('without a token there is no warning in normal mode, and the mode is still logged', async () => {
  const { logs } = await start({ LOG_LEVEL: 'info' });
  expect(logs.lines().find((line) => line['msg'] === 'config.mode')).toMatchObject({ mode: 'normal' });
  expect(logs.lines().filter((line) => line['variable'] === 'SETUP_TOKEN')).toEqual([]);
});

test.each([
  ['a token and no App', { SETUP_TOKEN: TEST_SETUP_TOKEN }, 'setup', false],
  ['nothing', {}, 'normal', false],
  ['a token and part of an App', { SETUP_TOKEN: TEST_SETUP_TOKEN, GITHUB_CLIENT_ID: 'id' }, 'normal', true],
])('the configuration log with %s says mode %s, and warns about a dropped token: %s', (_label, env, mode, warns) => {
  const logs = captureLogs();
  logConfiguration(createLogger({ logLevel: 'info' }, logs.destination), testConfig(env));
  const lines = logs.lines();
  expect(lines.find((line) => line['msg'] === 'config.mode')).toMatchObject({ level: 30, mode });
  expect(lines.some((line) => line['variable'] === 'SETUP_TOKEN')).toBe(warns);
});
