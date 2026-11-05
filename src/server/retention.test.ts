// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { expect, onTestFinished, test, vi } from 'vitest';
import type { RetentionCliOptions } from './adapters/db/retention-cli.ts';

// retention.ts runs on import: these tests are its entry test (E22-S04). The logic is tested in adapters/db/retention-cli.test.ts.

test('the entry hands the command the arguments after the script name and the process environment, and exits with its code', async () => {
  const runRetentionCli = vi.fn<(options: RetentionCliOptions) => Promise<number>>(() => Promise.resolve(2));
  vi.doMock('./adapters/db/retention-cli.ts', () => ({ runRetentionCli }));
  vi.resetModules();
  vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'src/server/retention.ts', '--dry-run']);
  onTestFinished(() => {
    vi.doUnmock('./adapters/db/retention-cli.ts');
    process.exitCode = undefined;
  });
  await import('./retention.ts');
  const options = runRetentionCli.mock.calls[0]?.[0];
  expect(options?.argv).toEqual(['--dry-run']);
  expect(options?.env).toBe(process.env);
  expect(process.exitCode).toBe(2);
});

test('the entry reports an invalid environment by variable name and exits 1', async () => {
  vi.stubEnv('DATABASE_URL', '');
  vi.resetModules();
  vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'src/server/retention.ts']);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  onTestFinished(() => {
    vi.unstubAllEnvs();
    process.exitCode = undefined;
  });
  await import('./retention.ts');
  expect(process.exitCode).toBe(1);
  expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).toBe(
    'retention failed: DATABASE_URL: must be a postgres:// or postgresql:// connection string (required; set it, or DATABASE_URL_FILE)\n',
  );
});
