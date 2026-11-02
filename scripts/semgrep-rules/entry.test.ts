// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import process from 'node:process';
import { afterEach, expect, test, vi } from 'vitest';

const REPOSITORY = path.resolve(import.meta.dirname, '../..');

afterEach(() => {
  process.exitCode = undefined;
  vi.doUnmock('./cli.ts');
  vi.resetModules();
  vi.restoreAllMocks();
});

/** Run the entry script as `node scripts/fetch-semgrep-rules.ts ...args`. */
async function runEntry(args: string[]): Promise<void> {
  const argv = process.argv;
  vi.resetModules();
  process.argv = ['node', 'fetch-semgrep-rules.ts', ...args];
  try {
    await import('../fetch-semgrep-rules.ts');
  } finally {
    process.argv = argv;
  }
}

test('the entry script hands its arguments, the rules directory, the streams and the real fetch to the CLI', async () => {
  const main = vi.fn(() => Promise.resolve(1));
  vi.doMock('./cli.ts', () => ({ main }));
  await runEntry(['--x']);
  const stdIo = (await import('../ci/lib/io.ts')).stdIo;
  expect(main).toHaveBeenCalledExactlyOnceWith(['--x'], path.join(REPOSITORY, 'rules'), stdIo, fetch);
  expect(process.exitCode).toBe(1);
});

test('the entry script runs the real CLI: an argument is a usage error with exit code 2 and no download', async () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in this test'));
  await runEntry(['typescript']);
  expect(process.exitCode).toBe(2);
  expect(stderr.mock.calls.join('')).toContain('usage: node scripts/fetch-semgrep-rules.ts (no arguments)');
  expect(network).not.toHaveBeenCalled();
});
