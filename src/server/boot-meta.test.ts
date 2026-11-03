// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, onTestFinished, test } from 'vitest';
import { openPgliteDatabase } from './adapters/db/pglite.ts';
import { mockApp } from './adapters/github/test-support.ts';
import { boot } from './boot.ts';
import { testRsaKey } from './config/test-support.ts';
import { FakeProcess, freePort, startFakeJobQueue, UNREACHABLE_DATABASE_URL } from './test-support.ts';

// E17-S09: the install address of GET /api/meta comes from the App slug that the start-up self-check verified (E05-S02).

async function start(env: Record<string, string>) {
  const db = await openPgliteDatabase();
  const server = await boot({
    env: {
      DATABASE_URL: UNREACHABLE_DATABASE_URL,
      HOST: '127.0.0.1',
      PORT: String(await freePort()),
      LOG_LEVEL: 'silent',
      ...env,
    },
    signals: new FakeProcess(),
    createDb: () => db,
    createJobQueue: startFakeJobQueue,
    reconcileOnStart: false,
  });
  onTestFinished(async () => {
    await server?.close();
  });
  return server?.address ?? '';
}

const meta = async (address: string): Promise<unknown> => (await fetch(`${address}/api/meta`)).json();

test('with the App configured and verified the install address names its slug', async () => {
  const key = testRsaKey();
  mockApp([key.publicKey]);
  const address = await start({ GITHUB_APP_ID: '4242', GITHUB_APP_PRIVATE_KEY: key.pkcs1 });
  expect(await meta(address)).toEqual({
    sourceUrl: 'https://github.com/Axiumine/cla-gate',
    commit: null,
    installUrl: 'https://github.com/apps/cla-gate-test/installations/new',
  });
});

test('without the App the install address is null and the configured source is served', async () => {
  const address = await start({ SOURCE_COMMIT: 'f'.repeat(40) });
  expect(await meta(address)).toEqual({
    sourceUrl: 'https://github.com/Axiumine/cla-gate',
    commit: 'f'.repeat(40),
    installUrl: null,
  });
});
