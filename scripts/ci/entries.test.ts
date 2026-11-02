// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import process from 'node:process';
import { afterEach, expect, test, vi } from 'vitest';
import { makeRepo, tempDir } from '../code-caps/test-support.ts';
import type { Io } from './lib/io.ts';

const REPOSITORY = path.resolve(import.meta.dirname, '../..');

afterEach(() => {
  process.exitCode = undefined;
  vi.doUnmock('./lib/free-port-cli.ts');
  vi.doUnmock('./lib/postgres-cli.ts');
  vi.doUnmock('./lib/e2e-cli.ts');
  vi.doUnmock('./lib/guard-cli.ts');
  vi.resetModules();
  vi.restoreAllMocks();
});

const ENTRIES: ReadonlyMap<string, () => Promise<unknown>> = new Map([
  ['free-port.ts', () => import('./free-port.ts')],
  ['postgres.ts', () => import('./postgres.ts')],
  ['e2e.ts', () => import('./e2e.ts')],
  ['check-runners.ts', () => import('./check-runners.ts')],
]);

/** Imports an entry script fresh, as `node <entry> ...args` would run it; resolves with the streams it was given. */
async function runEntry(entry: string, args: string[]): Promise<Io> {
  const argv = process.argv;
  vi.resetModules();
  process.argv = ['node', entry, ...args];
  try {
    await ENTRIES.get(entry)?.();
  } finally {
    process.argv = argv;
  }
  return (await import('./lib/io.ts')).stdIo;
}

test('free-port prints exactly one port in the range and exits 0', async () => {
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  await runEntry('free-port.ts', []);
  expect(process.exitCode).toBe(0);
  const written = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
  expect(written).toMatch(/^\d{5}\n$/);
  expect(Number(written)).toBeGreaterThanOrEqual(32_769);
  expect(Number(written)).toBeLessThanOrEqual(60_999);
});

test('free-port hands the standard streams to the CLI and sets its exit code', async () => {
  const runFreePortCli = vi.fn(() => Promise.resolve(1));
  vi.doMock('./lib/free-port-cli.ts', () => ({ runFreePortCli }));
  const stdIo = await runEntry('free-port.ts', []);
  expect(runFreePortCli).toHaveBeenCalledExactlyOnceWith(stdIo);
  expect(process.exitCode).toBe(1);
});

test('postgres hands its arguments, the environment, the streams and the real dependencies to the CLI', async () => {
  const runPostgresCli = vi.fn(() => Promise.resolve(2));
  vi.doMock('./lib/postgres-cli.ts', () => ({ runPostgresCli }));
  const stdIo = await runEntry('postgres.ts', ['stop']);
  const { systemDeps } = await import('./lib/postgres-deps.ts');
  expect(runPostgresCli).toHaveBeenCalledExactlyOnceWith(['stop'], process.env, stdIo, systemDeps);
  expect(process.exitCode).toBe(2);
});

test('e2e hands its arguments, the environment, the streams and the real dependencies to the CLI', async () => {
  const runE2eCli = vi.fn(() => Promise.resolve(3));
  vi.doMock('./lib/e2e-cli.ts', () => ({ runE2eCli }));
  const stdIo = await runEntry('e2e.ts', ['run', 'yarn', 'e2e']);
  const { systemDeps } = await import('./lib/e2e-deps.ts');
  expect(runE2eCli).toHaveBeenCalledExactlyOnceWith(['run', 'yarn', 'e2e'], process.env, stdIo, systemDeps);
  expect(process.exitCode).toBe(3);
});

test('check-runners checks the repository root by default', async () => {
  const main = vi.fn(() => 1);
  vi.doMock('./lib/guard-cli.ts', () => ({ main }));
  const stdIo = await runEntry('check-runners.ts', ['--root', '/x']);
  expect(main).toHaveBeenCalledExactlyOnceWith(['--root', '/x'], REPOSITORY, stdIo);
  expect(process.exitCode).toBe(1);
});

test('check-runners runs the real guard and reports a clean repository', async () => {
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  await runEntry('check-runners.ts', []);
  expect(process.exitCode).toBe(0);
  expect(stdout.mock.calls.join('')).toMatch(/^ci runners ok \(\d+ workflow file\(s\)\)\n$/);
});

test('check-runners exits 1 on a violation in the directory it is pointed at', async () => {
  const root = tempDir();
  makeRepo(root, {
    '.github/workflows/ci.yml':
      'on: push\npermissions:\n  contents: read\njobs:\n  a:\n    runs-on: ubuntu-latest\n    timeout-minutes: 1\n',
  });
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  await runEntry('check-runners.ts', ['--root', root]);
  expect(process.exitCode).toBe(1);
  expect(stderr.mock.calls.join('')).toContain('R1 runs-on must be');
});
