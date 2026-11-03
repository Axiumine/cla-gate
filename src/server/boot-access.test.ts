// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import { expect, test, vi } from 'vitest';
import { openPgliteDatabase } from './adapters/db/pglite.ts';
import type * as AppModule from './app.ts';
import { boot } from './boot.ts';
import { captureLogs, FakeProcess, freePort, startFakeJobQueue, UNREACHABLE_DATABASE_URL } from './test-support.ts';

// Start-up with a route that has no access declaration (E11-S01): `buildApp` is wrapped so that the app it returns gets two
// routes from a plugin, one with no declaration under `/api`, as a module that slipped one in would.

vi.mock('./app.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof AppModule>();
  const buildApp: typeof actual.buildApp = async (options) => {
    const app = await actual.buildApp(options);
    await app.register(
      // eslint-disable-next-line @typescript-eslint/require-await -- Fastify plugins are async; a throw in a callback-style plugin is not caught by avvio
      async (instance) => {
        instance.get('/forgotten', () => 'x');
        instance.post('/also-forgotten', { config: { audit: 'repository.enabled' } }, () => 'x');
      },
      { prefix: '/api/v2' },
    );
    return app;
  };
  return { ...actual, buildApp };
});

test('boot refuses to start while a route lacks its access declaration: it logs RouteAccessError with every route, exits 1 and listens on nothing', async () => {
  const logs = captureLogs();
  const signals = new FakeProcess();
  const db = await openPgliteDatabase();
  const env = {
    DATABASE_URL: UNREACHABLE_DATABASE_URL,
    HOST: '127.0.0.1',
    PORT: String(await freePort()),
    LOG_LEVEL: 'info',
  };
  const server = await boot({
    env,
    signals,
    createDb: () => db,
    createJobQueue: startFakeJobQueue,
    logDestination: logs.destination,
  });
  expect(server).toBeUndefined();
  expect(signals.exitCode).toBe(1);
  const failure = logs.lines().find((line) => line['msg'] === 'failed to start');
  expect(failure).toMatchObject({ level: 60, err: { type: 'RouteAccessError' } });
  const message = JSON.stringify(failure);
  expect(message).toContain('route GET /api/v2/forgotten declares no config.access');
  expect(message).toContain('route POST /api/v2/also-forgotten declares no config.access');
  await expect(fetch(`http://127.0.0.1:${env.PORT}/healthz`)).rejects.toThrow();
});
