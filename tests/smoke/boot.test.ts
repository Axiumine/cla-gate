// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { listNames } from '../../scripts/smoke/files.ts';
import { assetPaths, inlineHandlers, inlineScripts } from '../../scripts/smoke/html.ts';
import { inspectService, output, sqlAs } from '../../scripts/smoke/probe.ts';
import { get, stack } from './support.ts';

// E19-S08, setup-mode boot: the stack of docker-compose.yml with no GitHub App yet, from a clean checkout. postgres is
// healthy, migrate has exited 0 and recorded every migration file, app is healthy by Docker's own health check, and the
// application answers like the single-page app it is.

const MIGRATIONS = path.resolve(import.meta.dirname, '../../migrations');
const HTML = { accept: 'text/html' };
const compare = (a: string, b: string): number => a.localeCompare(b);

test('postgres is running and healthy', async () => {
  const container = await inspectService(stack, 'postgres');
  expect([container.State.Status, container.State.Health?.Status]).toEqual(['running', 'healthy']);
});

test('migrate ran to completion and exited 0', async () => {
  const container = await inspectService(stack, 'migrate');
  expect([container.State.Status, container.State.ExitCode]).toEqual(['exited', 0]);
});

test('schema_migrations holds one row per file of migrations/', async () => {
  const files = listNames(MIGRATIONS).filter((name) => name.endsWith('.sql'));
  const rows = await sqlAs(stack, 'cla_owner', 'select name from schema_migrations');
  expect(rows.code, output(rows)).toBe(0);
  expect(files.length).toBeGreaterThan(0);
  // Both sides in the same order: the order of the database's collation is not the point, one row per file is.
  expect(rows.stdout.trim().split('\n').toSorted(compare)).toEqual(files.toSorted(compare));
});

test('app is healthy by the health check of the image', async () => {
  const container = await inspectService(stack, 'app');
  expect([container.State.Status, container.State.Health?.Status]).toEqual(['running', 'healthy']);
});

test('GET /healthz answers 200 with the liveness body', async () => {
  const response = await get('/healthz');
  expect([response.status, await response.json()]).toEqual([200, { status: 'ok' }]);
});

test('GET /readyz answers 200 while the database is up', async () => {
  expect((await get('/readyz')).status).toBe(200);
});

test('GET / returns the single-page app with a content security policy and no script in the page', async () => {
  const response = await get('/', HTML);
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/html');
  expect(html).toContain('<div id="root">');
  expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
  expect(inlineScripts(html)).toEqual([]);
  expect(inlineHandlers(html)).toEqual([]);
});

test('a hashed asset of the page is served as immutable and the page itself is revalidated', async () => {
  const page = await get('/', HTML);
  const [asset] = assetPaths(await page.text());
  expect(asset?.startsWith('/assets/')).toBe(true);
  expect(asset).toMatch(/\.(js|css)$/);
  expect(page.headers.get('cache-control')).toBe('no-cache');
  const served = await get(asset ?? '');
  expect(served.status).toBe(200);
  expect(served.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
});

test('GET /api/setup/status says the instance is in setup mode', async () => {
  const response = await get('/api/setup/status');
  expect([response.status, await response.json()]).toEqual([200, { mode: 'setup' }]);
});

test('no service has written a secret of the stack to its log', async () => {
  const logs = await stack.compose(['logs', '--no-color']);
  expect(logs.code, output(logs)).toBe(0);
  const text = `${logs.stdout}${logs.stderr}`;
  const names = listNames(path.join(stack.directory, 'secrets')).filter((name) => stack.secret(name).length >= 8);
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) {
    expect(text.includes(stack.secret(name)), `secrets/${name} appears in the logs`).toBe(false);
  }
});
