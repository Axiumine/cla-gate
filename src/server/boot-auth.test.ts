// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { EventEmitter } from 'node:events';
import { expect, onTestFinished, test } from 'vitest';
import { openPgliteDatabase } from './adapters/db/pglite.ts';
import { boot } from './boot.ts';
import { AUTH_ENV, TEST_CLIENT_SECRET, TEST_SESSION_SECRET } from './config/auth-fixture/test-support.ts';
import { captureLogs, freePort, UNREACHABLE_DATABASE_URL } from './test-support.ts';

// What start-up says about login (E10-S01): the server starts without the login settings outside production, and the
// log tells the operator why there are no login routes.

class FakeProcess extends EventEmitter {
  exitCode: number | string | null | undefined;
}

async function start(env: Record<string, string>, github?: typeof fetch) {
  const logs = captureLogs();
  const db = await openPgliteDatabase();
  const server = await boot({
    env: {
      DATABASE_URL: UNREACHABLE_DATABASE_URL,
      HOST: '127.0.0.1',
      PORT: String(await freePort()),
      LOG_LEVEL: 'info',
      ...env,
    },
    signals: new FakeProcess(),
    createDb: () => db,
    logDestination: logs.destination,
    reconcileOnStart: false,
    ...(github === undefined ? {} : { fetch: github }),
  });
  onTestFinished(async () => {
    await server?.close();
  });
  return { server, logs };
}

test('without the login settings the server still starts and says which variables are missing', async () => {
  const { server, logs } = await start({});
  expect(server).toBeDefined();
  expect(logs.lines().find((line) => line['msg'] === 'auth.not_configured')).toMatchObject({
    level: 30,
    missing: ['SESSION_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
  });
});

test('with the login settings it logs the lifetimes and never a secret', async () => {
  const { server, logs } = await start({ ...AUTH_ENV, SESSION_IDLE_SECONDS: '600', SESSION_ABSOLUTE_SECONDS: '1200' });
  expect(server).toBeDefined();
  expect(logs.lines().find((line) => line['msg'] === 'auth.configured')).toMatchObject({
    level: 30,
    idleSeconds: 600,
    absoluteSeconds: 1200,
  });
  expect(logs.text()).not.toContain(TEST_SESSION_SECRET);
  expect(logs.text()).not.toContain(TEST_CLIENT_SECRET);
});

test('an invalid lifetime stops the start by name, with nothing opened', async () => {
  const errors: string[] = [];
  const logs = captureLogs();
  let opened = false;
  const signals = new FakeProcess();
  const server = await boot({
    env: { DATABASE_URL: UNREACHABLE_DATABASE_URL, SESSION_IDLE_SECONDS: '299' },
    signals,
    createDb: () => {
      opened = true;
      return openPgliteDatabase();
    },
    logDestination: logs.destination,
    err: (line) => errors.push(line),
  });
  expect(server).toBeUndefined();
  expect(signals.exitCode).toBe(1);
  expect(opened).toBe(false);
  expect(errors).toEqual(['ConfigError: Invalid environment configuration: SESSION_IDLE_SECONDS']);
});

test('the login reaches GitHub through the fetch that boot was given (E10-S05)', async () => {
  const called: string[] = [];
  const github: typeof fetch = (input) => {
    called.push(new Request(input).url);
    return Promise.resolve(new Response('{}', { status: 500 }));
  };
  const { server } = await start(AUTH_ENV, github);
  const address = server?.address ?? '';
  const login = await fetch(`${address}/api/auth/login`, { redirect: 'manual' });
  const cookie = (login.headers.getSetCookie()[0] ?? '').split(';')[0] ?? '';
  const state = new URL(login.headers.get('location') ?? '').searchParams.get('state') ?? '';
  const callback = await fetch(`${address}/api/auth/callback?code=made-up&state=${state}`, {
    redirect: 'manual',
    headers: { cookie },
  });
  expect(callback.headers.get('location')).toBe('/login/failed?reason=github_unavailable');
  expect(called).toEqual(['https://github.com/login/oauth/access_token']);
});
