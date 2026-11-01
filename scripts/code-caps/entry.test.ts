// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import process from 'node:process';
import { expect, test, vi } from 'vitest';
import { makeRepo, tempDir } from './test-support.ts';

/** Run the entry script as `node scripts/check-code-caps.ts ...args`. */
async function runEntry(args: string[]): Promise<void> {
  const argv = process.argv;
  vi.resetModules();
  process.argv = ['node', 'check-code-caps.ts', ...args];
  try {
    await import('../check-code-caps.ts');
  } finally {
    process.argv = argv;
  }
}

test('the entry script runs the check and sets the exit code', async () => {
  const root = tempDir();
  makeRepo(root, { 'ok.ts': 'export const a = 1;\n' });
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  await runEntry(['--root', root]);
  expect(process.exitCode).toBe(0);
  expect(stdout).toHaveBeenCalledWith('code caps ok (0 tolerated violation(s) in the baseline)\n');
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

test('the entry script defaults the root to the repository root, one level above scripts/', async () => {
  const main = vi.fn(() => 0);
  vi.doMock('./cli.ts', () => ({ main }));
  await runEntry(['--init']);
  vi.doUnmock('./cli.ts');
  vi.resetModules();
  process.exitCode = undefined;
  expect(main).toHaveBeenCalledWith(['--init'], path.resolve(import.meta.dirname, '..', '..'));
});
