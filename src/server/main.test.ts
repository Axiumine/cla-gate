// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { expect, onTestFinished, test, vi } from 'vitest';
import { UNREACHABLE_DATABASE_URL } from './test-support.ts';

// main.ts runs on import: these tests are its boot test. It is imported fresh each time, from the environment.

async function importMain(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value);
  }
  vi.resetModules();
  onTestFinished(() => {
    vi.unstubAllEnvs();
    process.exitCode = undefined;
  });
  return import('./main.ts');
}

test('main boots the server from process.env and shuts down on SIGTERM', async () => {
  const before = process.listenerCount('SIGTERM');
  const { server } = await importMain({
    DATABASE_URL: UNREACHABLE_DATABASE_URL,
    HOST: '127.0.0.1',
    PORT: '0',
    LOG_LEVEL: 'silent',
  });
  expect(server?.address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect((await fetch(`${server?.address}/healthz`)).status).toBe(200);
  expect(process.listenerCount('SIGTERM')).toBe(before + 1);
  process.emit('SIGTERM');
  await vi.waitFor(async () => {
    await expect(fetch(`${server?.address}/healthz`)).rejects.toThrow();
  });
  expect(process.listenerCount('SIGTERM')).toBe(before);
  expect(process.exitCode).toBeUndefined();
});

test('main reports an invalid environment and exits with code 1', async () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const { server } = await importMain({ DATABASE_URL: '', PORT: '99999' });
  expect(server).toBeUndefined();
  expect(process.exitCode).toBe(1);
  expect(stderr).toHaveBeenCalledExactlyOnceWith(
    'ConfigError: Invalid environment configuration: DATABASE_URL, PORT\n',
  );
});
