// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import net from 'node:net';
import process from 'node:process';
import type { LogFn } from 'pino';
import { expect, onTestFinished, test, vi } from 'vitest';
import { openPgliteDatabase } from './adapters/db/pglite.ts';
import { type BootOptions, boot, type RunningServer } from './boot.ts';
import { publicKeyFingerprint } from './config/github-key.ts';
import { testRsaKey } from './config/test-support.ts';
import { captureLogs, FakeProcess, freePort, UNREACHABLE_DATABASE_URL } from './test-support.ts';

const BASE_ENV = { DATABASE_URL: UNREACHABLE_DATABASE_URL, HOST: '127.0.0.1', LOG_LEVEL: 'silent' };

/** The base environment plus a random free port: never PORT=0, which asks the kernel's ephemeral range. */
const freshEnv = async (): Promise<Record<string, string>> => ({ ...BASE_ENV, PORT: String(await freePort()) });

async function start(given?: Record<string, string>, shutdownTimeoutMs?: number) {
  const env = given ?? (await freshEnv());
  const signals = new FakeProcess();
  const db = await openPgliteDatabase();
  const createDb = vi.fn<NonNullable<BootOptions['createDb']>>(() => db);
  const server = await boot({
    env,
    signals,
    createDb,
    ...(shutdownTimeoutMs === undefined ? {} : { shutdownTimeoutMs }),
  });
  onTestFinished(async () => {
    await server?.close();
  });
  return { signals, db, createDb, server };
}

const status = async (server: RunningServer | undefined, path: string): Promise<number> =>
  (await fetch(`${server?.address}${path}`)).status;

test('boot starts the app on the configured address and serves health and readiness from PGlite', async () => {
  const { server, createDb } = await start();
  expect(server?.address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(await status(server, '/healthz')).toBe(200);
  expect(await status(server, '/readyz')).toBe(200);
  expect(createDb).toHaveBeenCalledOnce();
  expect(createDb.mock.calls[0]?.[0].databaseUrl.reveal()).toBe(UNREACHABLE_DATABASE_URL);
});

test('close stops the server, removes the signal handlers and may be called twice', async () => {
  const { server, signals } = await start();
  expect([signals.listenerCount('SIGINT'), signals.listenerCount('SIGTERM')]).toEqual([1, 1]);
  await server?.close();
  await server?.close();
  expect([signals.listenerCount('SIGINT'), signals.listenerCount('SIGTERM')]).toEqual([0, 0]);
  await expect(fetch(`${server?.address}/healthz`)).rejects.toThrow();
});

test.each([['SIGINT'], ['SIGTERM']])('%s shuts the server down cleanly', async (signal) => {
  const { server, signals, db } = await start();
  signals.emit(signal);
  await vi.waitFor(async () => {
    await expect(fetch(`${server?.address}/healthz`)).rejects.toThrow();
  });
  expect(signals.exitCode).toBeUndefined();
  await expect(db.selectFrom('users').selectAll().execute()).rejects.toThrow('driver has already been destroyed');
});

/** A request whose headers arrived (the server answered `100 Continue`) and whose body never will. */
async function openUnfinishedRequest(address: string | undefined): Promise<{ closed: Promise<void> }> {
  const { hostname, port } = new URL(address ?? '');
  const socket = net.connect({ host: hostname, port: Number(port) });
  const closed = new Promise<void>((resolve) => {
    socket.on('close', () => {
      resolve();
    });
  });
  socket.on('error', () => undefined);
  const answered = new Promise<void>((resolve) => {
    socket.once('data', () => {
      resolve();
    });
  });
  socket.write('POST /healthz HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\nExpect: 100-continue\r\n\r\n');
  await answered;
  return { closed };
}

test('a request that never finishes cannot hold the shutdown past its deadline: the connection is dropped, exit code 1', async () => {
  const { server, signals } = await start(undefined, 50);
  const request = await openUnfinishedRequest(server?.address);
  signals.emit('SIGTERM');
  await server?.close();
  await request.closed;
  expect(signals.exitCode).toBe(1);
  expect([signals.listenerCount('SIGINT'), signals.listenerCount('SIGTERM')]).toEqual([0, 0]);
});

test('a second signal drops the open connections at once instead of waiting for the deadline', async () => {
  const { server, signals } = await start(undefined, 600_000);
  const request = await openUnfinishedRequest(server?.address);
  signals.emit('SIGTERM');
  expect(signals.listenerCount('SIGTERM')).toBe(1);
  signals.emit('SIGINT');
  await server?.close();
  await request.closed;
  expect(signals.exitCode).toBe(1);
});

test('a failing shutdown is logged and sets the exit code', async () => {
  const { server, signals, db } = await start();
  const destroy = vi.spyOn(db, 'destroy').mockRejectedValueOnce(new Error('destroy failed'));
  await server?.close();
  expect(destroy).toHaveBeenCalledOnce();
  expect(signals.exitCode).toBe(1);
  await db.destroy();
});

test('an invalid configuration is reported by variable name and nothing starts', async () => {
  const signals = new FakeProcess();
  const err = vi.fn();
  const createDb = vi.fn();
  const server = await boot({ env: { PORT: 'http', LOG_LEVEL: 'loud' }, signals, createDb, err });
  expect(server).toBeUndefined();
  expect(signals.exitCode).toBe(1);
  expect(err).toHaveBeenCalledExactlyOnceWith(
    'ConfigError: Invalid environment configuration: DATABASE_URL, LOG_LEVEL, PORT',
  );
  expect(createDb).not.toHaveBeenCalled();
  expect(signals.listenerCount('SIGTERM')).toBe(0);
});

test('without an err sink the report goes to stderr', async () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const signals = new FakeProcess();
  await boot({ env: {}, signals });
  expect(stderr).toHaveBeenCalledExactlyOnceWith('ConfigError: Invalid environment configuration: DATABASE_URL\n');
});

test('a port that is taken fails the start, releases the database and sets the exit code', async () => {
  const first = await start();
  const port = new URL(first.server?.address ?? '').port;
  const second = await start({ ...BASE_ENV, PORT: port });
  expect(second.server).toBeUndefined();
  expect(second.signals.exitCode).toBe(1);
  await expect(second.db.selectFrom('users').selectAll().execute()).rejects.toThrow(
    'driver has already been destroyed',
  );
  expect(await status(first.server, '/healthz')).toBe(200);
});

test('a port that is taken is logged as fatal, with the error that stopped the start', async () => {
  const first = await start();
  const db = await openPgliteDatabase();
  const fatalCalls: unknown[][] = [];
  const fatal: LogFn = (...args: unknown[]) => {
    fatalCalls.push(args);
  };
  const createDb: NonNullable<BootOptions['createDb']> = (_config, logger) => {
    logger.fatal = fatal;
    return db;
  };
  const env = { ...BASE_ENV, PORT: new URL(first.server?.address ?? '').port };
  expect(await boot({ env, signals: new FakeProcess(), createDb })).toBeUndefined();
  expect(fatalCalls).toHaveLength(1);
  expect(fatalCalls[0]).toMatchObject([{ err: { code: 'EADDRINUSE' } }, 'failed to start']);
});

test('by default it connects with node-postgres, so an unreachable database means live but not ready', async () => {
  const signals = new FakeProcess();
  const server = await boot({ env: await freshEnv(), signals });
  onTestFinished(async () => {
    await server?.close();
  });
  expect(await status(server, '/healthz')).toBe(200);
  expect(await status(server, '/readyz')).toBe(503);
});

/** Boots on PGlite with `LOG_LEVEL=info`, collecting the log lines. */
async function startLogging(extra: Record<string, string>) {
  const logs = captureLogs();
  const db = await openPgliteDatabase();
  const server = await boot({
    env: { ...(await freshEnv()), LOG_LEVEL: 'info', ...extra },
    signals: new FakeProcess(),
    createDb: () => db,
    logDestination: logs.destination,
  });
  onTestFinished(async () => {
    await server?.close();
  });
  return { server, logs };
}

test('without GitHub credentials the server still starts, serves health and says the GitHub App is not configured', async () => {
  const { server, logs } = await startLogging({});
  expect(await status(server, '/healthz')).toBe(200);
  expect(await status(server, '/readyz')).toBe(200);
  expect(logs.lines().find((line) => line['msg'] === 'github.app_not_configured')).toMatchObject({
    level: 30,
    missing: ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY'],
  });
});

test('with GitHub credentials it logs the App id and the key fingerprint at start-up, and never the key', async () => {
  const key = testRsaKey();
  const { server, logs } = await startLogging({ GITHUB_APP_ID: '4242', GITHUB_APP_PRIVATE_KEY: key.pkcs1 });
  expect(await status(server, '/healthz')).toBe(200);
  expect(logs.lines().find((line) => line['msg'] === 'github.app_configured')).toMatchObject({
    appId: '4242',
    keyFingerprints: [publicKeyFingerprint(key.publicKey)],
  });
  expect(logs.text()).not.toContain('PRIVATE KEY');
  expect(logs.text()).not.toContain(key.pkcs1.split('\n')[1] ?? 'missing');
});
