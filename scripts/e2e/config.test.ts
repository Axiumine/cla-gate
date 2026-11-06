// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import process from 'node:process';
import { afterEach, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { PORT_MAX, PORT_MIN } from '../ci/lib/ports.ts';
import { exists } from '../ci/lib/test-support.ts';
import { ROOT } from '../semgrep-rules/test-support.ts';

// E20-S06: loads the real playwright.config.ts, the way Playwright does, and pins what it decides.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const configSchema = z.object({
  testDir: z.string(),
  globalSetup: z.string(),
  snapshotPathTemplate: z.string(),
  expect: z.object({ toHaveScreenshot: z.object({ animations: z.string(), maxDiffPixels: z.number() }) }),
  updateSnapshots: z.string(),
  retries: z.number(),
  workers: z.number(),
  forbidOnly: z.boolean(),
  use: z.object({ baseURL: z.string(), trace: z.string(), launchOptions: z.object({ args: z.array(z.string()) }) }),
  webServer: z.object({
    command: z.string(),
    url: z.string(),
    env: z.record(z.string(), z.string()),
    reuseExistingServer: z.boolean(),
    timeout: z.number(),
  }),
});

/** The config exactly as Playwright reads it: the default export of a fresh import of the file. */
async function importConfig() {
  vi.resetModules();
  const module: { default: unknown } = await import('../../playwright.config.ts');
  return configSchema.parse(module.default);
}

/** The config as a fresh import sees it, with `CI`, `E2E_PORT` and `DATABASE_URL` set as given (undefined removes them). */
async function loadConfig(env: Readonly<Record<string, string | undefined>> = {}) {
  for (const name of ['CI', 'E2E_PORT', 'E2E_CONTAINER']) {
    vi.stubEnv(name, undefined);
  }
  vi.stubEnv('DATABASE_URL', 'postgres://u:p@127.0.0.1:41000/db');
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value);
  }
  return importConfig();
}

test('the tests live in e2e, and a baseline path has no platform in it', async () => {
  const config = await loadConfig();
  expect(config.testDir).toBe('e2e');
  expect(config.snapshotPathTemplate).toBe('{testDir}/__screenshots__/{testFilePath}/{arg}{ext}');
  expect(config.snapshotPathTemplate).not.toContain('{platform}');
});

test('screenshots are compared with animations off and an explicit tolerance of 20 pixels', async () => {
  const config = await loadConfig();
  expect(config.expect.toHaveScreenshot).toEqual({ animations: 'disabled', maxDiffPixels: 20 });
});

test('no retry, one worker, and a run writes baselines only when it is told to', async () => {
  const config = await loadConfig();
  expect(config).toMatchObject({ retries: 0, workers: 1, updateSnapshots: 'none' });
});

test.each([
  ['unset', undefined, false],
  ['empty', '', false],
  ['true', 'true', true],
  ['1', '1', true],
])('forbidOnly with CI %s is %s', async (_what, ci, forbidden) => {
  expect((await loadConfig({ CI: ci })).forbidOnly).toBe(forbidden);
});

test('the global setup file named by the config exists', async () => {
  const config = await loadConfig();
  expect(exists(path.resolve(ROOT, config.globalSetup))).toBe(true);
});

test('the browser draws whole tiles, so a box that grows after the first paint gives the same pixels on a busy machine (E18-S12)', async () => {
  expect((await loadConfig()).use.launchOptions.args).toEqual(['--disable-partial-raster']);
});

test('the server is `yarn start` on a random free loopback port above 32768, and its health URL is the one tests use', async () => {
  const config = await loadConfig();
  const port = Number(new URL(config.use.baseURL).port);
  expect(config.use.baseURL).toBe(`http://127.0.0.1:${port}`);
  expect(port).toBeGreaterThanOrEqual(PORT_MIN);
  expect(port).toBeLessThanOrEqual(PORT_MAX);
  expect(config.webServer).toMatchObject({
    command: 'yarn start',
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: false,
  });
  expect(config.webServer.env).toMatchObject({ PORT: String(port), HOST: '127.0.0.1' });
});

test('the chosen port is written back, so that every worker that loads the file agrees', async () => {
  const config = await loadConfig();
  const port = new URL(config.use.baseURL).port;
  expect(process.env['E2E_PORT']).toBe(port);
  expect((await importConfig()).use.baseURL).toBe(config.use.baseURL);
});

test('a port that is already chosen is kept', async () => {
  const config = await loadConfig({ E2E_PORT: '44444' });
  expect(config.use.baseURL).toBe('http://127.0.0.1:44444');
  expect(config.webServer.url).toBe('http://127.0.0.1:44444/healthz');
});

test('a well-known port in E2E_PORT is replaced by a random one', async () => {
  const config = await loadConfig({ E2E_PORT: '3000' });
  expect(Number(new URL(config.use.baseURL).port)).toBeGreaterThanOrEqual(PORT_MIN);
});

test('the server gets the database of the job and secrets that differ from one run to the next', async () => {
  const first = await loadConfig();
  const second = await loadConfig();
  expect(first.webServer.env['DATABASE_URL']).toBe('postgres://u:p@127.0.0.1:41000/db');
  expect(first.webServer.env['SESSION_SECRET']).toMatch(/^[0-9a-f]{64}$/);
  expect(first.webServer.env['SESSION_SECRET']).not.toBe(second.webServer.env['SESSION_SECRET']);
});

test('the server never receives a secret from the environment of the developer', async () => {
  const config = await loadConfig({
    SESSION_SECRET: 'real-session-secret-of-the-developer',
    GITHUB_CLIENT_SECRET: 'real-client',
  });
  expect(Object.values(config.webServer.env).join('\n')).not.toContain('real-');
});
