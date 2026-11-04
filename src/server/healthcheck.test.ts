// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createServer } from 'node:http';
import process from 'node:process';
import { expect, onTestFinished, test, vi } from 'vitest';
import { freePort } from './test-support.ts';

// healthcheck.ts runs on import: these tests are its entry test (E19-S01). The logic is tested in adapters/http/health-probe.test.ts.

async function importHealthcheck(port: number): Promise<string> {
  vi.stubEnv('PORT', String(port));
  vi.resetModules();
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  onTestFinished(() => {
    vi.unstubAllEnvs();
    process.exitCode = undefined;
  });
  await import('./healthcheck.ts');
  return stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
}

test('the entry exits with code 0 and prints nothing when the server of PORT answers /healthz', async () => {
  const port = await freePort();
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
  });
  await new Promise<void>((resolve) => {
    server.listen(port, '127.0.0.1', resolve);
  });
  onTestFinished(() => {
    server.close();
  });
  expect(await importHealthcheck(port)).toBe('');
  expect(process.exitCode).toBe(0);
});

test('the entry exits with code 1 and says so on stderr when nothing listens on PORT', async () => {
  const port = await freePort();
  expect(await importHealthcheck(port)).toBe(`healthcheck: no healthy answer from http://127.0.0.1:${port}/healthz\n`);
  expect(process.exitCode).toBe(1);
});
