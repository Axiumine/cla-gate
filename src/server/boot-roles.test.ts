// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { EventEmitter } from 'node:events';
import { expect, onTestFinished, test, vi } from 'vitest';
import { openPgliteDatabase } from './adapters/db/pglite.ts';
import { mockApp } from './adapters/github/test-support.ts';
import type { AppOptions } from './app.ts';
import { boot } from './boot.ts';
import { AUTH_ENV } from './config/auth-fixture/test-support.ts';
import { testGitHubKey } from './config/test-support.ts';
import { freePort, UNREACHABLE_DATABASE_URL } from './test-support.ts';

// What the start-up gives the guard of the tenant routes to read roles with (E11-S05): the GitHub client of the App when
// there is one, and nothing when there is not, so that the application falls back to a GitHub that always fails.

const built = vi.hoisted((): AppOptions[] => []);

vi.mock('./app.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./app.ts')>();
  return {
    ...actual,
    buildApp: (options: AppOptions) => {
      built.push(options);
      return actual.buildApp(options);
    },
  };
});

class FakeProcess extends EventEmitter {
  exitCode: number | string | null | undefined;
}

async function start(env: Record<string, string>) {
  built.length = 0;
  const db = await openPgliteDatabase();
  const server = await boot({
    env: {
      DATABASE_URL: UNREACHABLE_DATABASE_URL,
      HOST: '127.0.0.1',
      PORT: String(await freePort()),
      LOG_LEVEL: 'silent',
      ...AUTH_ENV,
      ...env,
    },
    signals: new FakeProcess(),
    createDb: () => db,
    reconcileOnStart: false,
  });
  onTestFinished(async () => {
    await server?.close();
    await db.destroy();
  });
  return server;
}

test('with a GitHub App the application is built with the client of the App to read roles with', async () => {
  const signing = testGitHubKey();
  mockApp([signing.publicKey]);
  const server = await start({ GITHUB_APP_ID: '4242', GITHUB_APP_PRIVATE_KEY: signing.pem });
  expect(server?.github).toBeDefined();
  expect(built).toHaveLength(1);
  expect(built[0]?.github).toBe(server?.github?.client);
});

test('with no GitHub App the application is built with no client, and falls back to the one that always fails', async () => {
  const server = await start({});
  expect(server?.github).toBeUndefined();
  expect(built).toHaveLength(1);
  expect(built[0]?.github).toBeUndefined();
});
