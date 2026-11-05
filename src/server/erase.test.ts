// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { expect, onTestFinished, test, vi } from 'vitest';
import type { CliOptions } from './adapters/db/cli-database.ts';

// erase.ts runs on import: these tests are its entry test (E22-S05). The logic is tested in adapters/db/erase-cli.test.ts.

test('the entry hands the command the arguments after the script name and the process environment, and exits with its code', async () => {
  const runEraseCli = vi.fn<(options: CliOptions) => Promise<number>>(() => Promise.resolve(3));
  vi.doMock('./adapters/db/erase-cli.ts', () => ({ runEraseCli }));
  vi.resetModules();
  vi.spyOn(process, 'argv', 'get').mockReturnValue([
    'node',
    'src/server/erase.ts',
    '--github-id',
    '42',
    '--actor-github-id',
    '7',
  ]);
  onTestFinished(() => {
    vi.doUnmock('./adapters/db/erase-cli.ts');
    process.exitCode = undefined;
  });
  await import('./erase.ts');
  const options = runEraseCli.mock.calls[0]?.[0];
  expect(options?.argv).toEqual(['--github-id', '42', '--actor-github-id', '7']);
  expect(options?.env).toBe(process.env);
  expect(process.exitCode).toBe(3);
});

test('the entry reports an invalid environment by variable name and exits 1', async () => {
  vi.stubEnv('DATABASE_URL', '');
  vi.resetModules();
  vi.spyOn(process, 'argv', 'get').mockReturnValue([
    'node',
    'src/server/erase.ts',
    '--github-id',
    '42',
    '--actor-github-id',
    '7',
  ]);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  onTestFinished(() => {
    vi.unstubAllEnvs();
    process.exitCode = undefined;
  });
  await import('./erase.ts');
  expect(process.exitCode).toBe(1);
  expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).toBe(
    'erase failed: DATABASE_URL: must be a postgres:// or postgresql:// connection string (required; set it, or DATABASE_URL_FILE)\n',
  );
});

test('the entry prints the usage and exits 2 for arguments the command does not take', async () => {
  vi.resetModules();
  vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'src/server/erase.ts']);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  onTestFinished(() => {
    process.exitCode = undefined;
  });
  await import('./erase.ts');
  expect(process.exitCode).toBe(2);
  expect(stderr.mock.calls).toEqual([
    ['usage: node src/server/erase.ts --github-id <n> --actor-github-id <n> [--execute]\n'],
  ]);
});
