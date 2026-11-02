// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { EventEmitter } from 'node:events';
import { HttpResponse } from 'msw';
import { expect, onTestFinished, test, vi } from 'vitest';
import { openPgliteDatabase } from './adapters/db/pglite.ts';
import { appBody, decodeJwt, mockApp, START } from './adapters/github/test-support.ts';
import { type BootOptions, boot } from './boot.ts';
import { AUTH_ENV } from './config/auth-fixture/test-support.ts';
import { TEST_WEBHOOK_SECRET, testGitHubKey } from './config/test-support.ts';
import { FakeClock } from './services/test-support.ts';
import { captureLogs, freePort, UNREACHABLE_DATABASE_URL } from './test-support.ts';

// What start-up does with the GitHub App (E05-S02): the self-check runs before the database is opened and before the
// port is bound, and only a failure that retrying cannot repair stops the start.

class FakeProcess extends EventEmitter {
  exitCode: number | string | null | undefined;
}

const PRODUCTION = {
  ...AUTH_ENV,
  NODE_ENV: 'production',
  PUBLIC_BASE_URL: 'https://cla.example.test',
  GITHUB_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
};

/** Boots on PGlite and a free port. `env` brings the signing key; the App id is 4242, like the one in `appBody`. */
async function start(env: Record<string, string>, extra: Partial<BootOptions> = {}) {
  const logs = captureLogs();
  const signals = new FakeProcess();
  const db = await openPgliteDatabase();
  const createDb = vi.fn(() => db);
  const server = await boot({
    env: {
      DATABASE_URL: UNREACHABLE_DATABASE_URL,
      HOST: '127.0.0.1',
      PORT: String(await freePort()),
      LOG_LEVEL: 'info',
      GITHUB_APP_ID: '4242',
      ...env,
    },
    signals,
    createDb,
    logDestination: logs.destination,
    // These tests are about the self-check; the reconciliation has its own (boot-reconcile.test.ts).
    reconcileOnStart: false,
    ...extra,
  });
  onTestFinished(async () => {
    await server?.close();
    await db.destroy();
  });
  return { server, signals, createDb, logs };
}

/** The key the server will sign with must be the one GitHub accepts: boot reads it from the environment. */
async function startWithAcceptedKey(env: Record<string, string>, answer?: () => Response) {
  const key = testGitHubKey();
  const route = mockApp([key.publicKey], answer);
  return { ...(await start({ GITHUB_APP_PRIVATE_KEY: key.pem, ...env })), route, key };
}

const status = async (address: string | undefined, path: string): Promise<number> =>
  (await fetch(`${address}${path}`)).status;

test('the self-check runs before the database is opened and the identity is on the running server', async () => {
  const { server, route, createDb } = await startWithAcceptedKey({});
  expect(route.tokens).toHaveLength(1);
  expect(server?.github?.identity.current()).toMatchObject({ appId: 4242, ownerId: 9001, ownerType: 'Organization' });
  expect(createDb).toHaveBeenCalledOnce();
  expect(await status(server?.address, '/healthz')).toBe(200);
});

test('a wrong App id stops the start: nothing is opened or bound, the exit code is 1, the log names GITHUB_APP_ID', async () => {
  const { server, signals, createDb, logs } = await startWithAcceptedKey({}, () =>
    HttpResponse.json(appBody({ id: 999 })),
  );
  expect(server).toBeUndefined();
  expect(signals.exitCode).toBe(1);
  expect(createDb).not.toHaveBeenCalled();
  expect(signals.listenerCount('SIGTERM')).toBe(0);
  expect(logs.lines().find((line) => line['msg'] === 'github.app_check_failed')).toMatchObject({
    level: 60,
    err: { type: 'ConfigError', message: 'Invalid environment configuration: GITHUB_APP_ID' },
  });
});

test('in production a refused key stops the start, and the log carries the fixed message only', async () => {
  const key = testGitHubKey();
  mockApp([testGitHubKey().publicKey]);
  const { server, signals, createDb, logs } = await start({ ...PRODUCTION, GITHUB_APP_PRIVATE_KEY: key.pem });
  expect(server).toBeUndefined();
  expect(signals.exitCode).toBe(1);
  expect(createDb).not.toHaveBeenCalled();
  expect(logs.lines().find((line) => line['msg'] === 'github.app_check_failed')).toMatchObject({
    err: { type: 'GitHubAuthError', message: 'GitHub refused every App signing key' },
  });
  expect(logs.text()).not.toContain(key.pem.split('\n')[1] ?? 'missing');
});

test('a GitHub outage at start-up does not stop the server: it warns, serves, and repeats the check on first use', async () => {
  const key = testGitHubKey();
  let up = false;
  mockApp([key.publicKey], () => (up ? HttpResponse.json(appBody()) : new HttpResponse(null, { status: 503 })));
  const { server, logs } = await start({ ...PRODUCTION, GITHUB_APP_PRIVATE_KEY: key.pem });
  expect(await status(server?.address, '/healthz')).toBe(200);
  expect(server?.github?.identity.current()).toBeUndefined();
  expect(logs.lines().find((line) => line['msg'] === 'github.app_check_deferred')).toMatchObject({ level: 40 });
  up = true;
  expect((await server?.github?.identity.verify())?.slug).toBe('cla-gate-test');
});

test('the clock and the fetch that boot is given are the ones the signer and the self-check use', async () => {
  const key = testGitHubKey();
  const clock = new FakeClock(START);
  const send = vi.fn(() => Promise.resolve(Response.json(appBody())));
  const { server } = await start({ GITHUB_APP_PRIVATE_KEY: key.pem }, { clock, fetch: send });
  expect(send).toHaveBeenCalledOnce();
  const iat = await server?.github?.withJwt((jwt) => Promise.resolve(decodeJwt(jwt).claims['iat']));
  expect(iat).toBe(Date.parse(START) / 1000 - 60);
});
