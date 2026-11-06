// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import process from 'node:process';
import { afterEach, expect, test, vi } from 'vitest';
import { makeRepo, tempDir } from '../code-caps/test-support.ts';

const REPOSITORY = path.resolve(import.meta.dirname, '../..');

afterEach(() => {
  process.exitCode = undefined;
  vi.doUnmock('./cli.ts');
  vi.resetModules();
  vi.restoreAllMocks();
});

/** Run the entry script as `node scripts/check-escape-hatches.ts ...args`. */
async function runEntry(args: string[]): Promise<void> {
  const argv = process.argv;
  vi.resetModules();
  process.argv = ['node', 'check-escape-hatches.ts', ...args];
  try {
    await import('../check-escape-hatches.ts');
  } finally {
    process.argv = argv;
  }
}

test('the entry script checks the repository root by default and sets the exit code', async () => {
  const main = vi.fn(() => 1);
  vi.doMock('./cli.ts', () => ({ main }));
  await runEntry(['--root', '/x']);
  const stdIo = (await import('../ci/lib/io.ts')).stdIo;
  expect(main).toHaveBeenCalledExactlyOnceWith(['--root', '/x'], REPOSITORY, stdIo);
  expect(process.exitCode).toBe(1);
});

test('the entry script runs the real check on a clean directory', async () => {
  const root = tempDir();
  makeRepo(root, { 'a.ts': 'export const a = 1;\n' });
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  await runEntry(['--root', root]);
  expect(process.exitCode).toBe(0);
  expect(stdout).toHaveBeenCalledWith('escape hatches ok (1 source file(s))\n');
});

test('the entry script exits 1 on an unjustified escape hatch', async () => {
  const root = tempDir();
  makeRepo(root, { 'a.ts': 'export const a: any = 1;\n' });
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  await runEntry(['--root', root]);
  expect(process.exitCode).toBe(1);
  expect(stderr.mock.calls.join('')).toContain('a.ts:1: any: missing "-- <reason>"');
});

// The whole repository is scanned by `yarn lint:hatches` (the `static` job and the pre-commit hook), which is the gate. This test
// runs the real entry script on real, tracked sources: the tool's own directory. A scan of the whole repository here took 64
// seconds on the slowest shared runner (2026-11-06, 2 900 files) and grows with every epic, so it did not tell a slow run
// from a wrong one; the default five seconds is no limit that means anything for a scan of one directory either.
const TOOL_DIRECTORY_SCAN_TIMEOUT_MS = 60_000;

test(
  'the sources of the tool itself have no unjustified escape hatch',
  async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await runEntry(['--root', path.join(REPOSITORY, 'scripts/escape-hatches')]);
    expect(stderr.mock.calls.join('')).toBe('');
    expect(stdout.mock.calls.join('')).toMatch(/^escape hatches ok \((?:[1-9]\d*) source file\(s\)\)\n$/);
    expect(process.exitCode).toBe(0);
  },
  TOOL_DIRECTORY_SCAN_TIMEOUT_MS,
);
