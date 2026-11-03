// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, onTestFinished, test } from 'vitest';
import { openPgliteDatabase } from './adapters/db/pglite.ts';
import { INDEX_HTML, webFixture } from './adapters/http/spa-fixture/test-support.ts';
import { boot } from './boot.ts';
import { FakeProcess, freePort, startFakeJobQueue, UNREACHABLE_DATABASE_URL } from './test-support.ts';

// E17-S03: the whole server on PGlite and a real socket, serving a fixture build of the app next to its API.

async function start(env: Record<string, string>) {
  const server = await boot({
    env: {
      DATABASE_URL: UNREACHABLE_DATABASE_URL,
      HOST: '127.0.0.1',
      LOG_LEVEL: 'silent',
      PORT: String(await freePort()),
      ...env,
    },
    signals: new FakeProcess(),
    createDb: () => openPgliteDatabase(),
    createJobQueue: startFakeJobQueue,
  });
  onTestFinished(async () => {
    await server?.close();
  });
  return server?.address ?? '';
}

test('GET / is the fixture index with the policy, and GET /readyz still answers its JSON', async () => {
  const { root } = webFixture();
  const address = await start({ NODE_ENV: 'test', WEB_ROOT: root });
  const index = await fetch(`${address}/`);
  expect([index.status, await index.text()]).toEqual([200, INDEX_HTML]);
  expect(index.headers.get('content-type')).toBe('text/html; charset=utf-8');
  expect(index.headers.get('content-security-policy')).toContain(
    "img-src 'self' https://avatars.githubusercontent.com",
  );
  expect(index.headers.get('cache-control')).toBe('no-cache');
  const ready = await fetch(`${address}/readyz`);
  expect([ready.status, await ready.json()]).toEqual([200, { status: 'ready' }]);
  expect((await fetch(`${address}/healthz`)).headers.get('content-type')).toMatch(/^application\/json/);
});

test('a browser asking for a route of the app gets the index, and a call to an unknown API path gets JSON', async () => {
  const { root } = webFixture();
  const address = await start({ NODE_ENV: 'test', WEB_ROOT: root });
  const page = await fetch(`${address}/orgs/42`, { headers: { accept: 'text/html' } });
  expect([page.status, await page.text()]).toEqual([200, INDEX_HTML]);
  const api = await fetch(`${address}/api/nope`, { headers: { accept: 'text/html' } });
  expect(api.status).toBe(404);
  expect(await api.json()).toMatchObject({ error: { code: 'not_found' } });
});

test('a server started for development serves no app', async () => {
  const { root } = webFixture();
  const address = await start({ NODE_ENV: 'development', WEB_ROOT: root });
  expect((await fetch(`${address}/`)).status).toBe(404);
  expect((await fetch(`${address}/readyz`)).status).toBe(200);
});
