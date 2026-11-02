// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { expect, test, vi } from 'vitest';
import { main } from './cli.ts';
import { capture, func, makeRepo, tempDir } from './test-support.ts';
import { BASELINE_NAME } from './types.ts';

const REPOSITORY = path.resolve(import.meta.dirname, '..', '..');
const ENTRY = path.join(REPOSITORY, 'scripts', 'check-code-caps.ts');

/** Runs the entry script as a process whose working directory is a fresh directory outside any repository. */
function runFromElsewhere(cwd: string, args: string[]) {
  const result = spawnSync(process.execPath, [ENTRY, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout.split('\n'), stderr: result.stderr.split('\n') };
}

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

test('run from a directory outside the repository, the entry script measures its own repository and not the working directory', () => {
  const cwd = tempDir();
  makeRepo(cwd, { 'huge.ts': func('huge', 60) });
  const expected = capture();
  const status = main([], REPOSITORY, expected.io);
  expect(runFromElsewhere(cwd, [])).toEqual({
    status,
    stdout: [...expected.out, ''],
    stderr: [...expected.err, ''],
  });
  expect(expected.err.join('\n')).not.toContain('huge.ts');
});

test('run from a directory outside the repository, the entry script finds the baseline of its own repository', () => {
  // `--init` writes a baseline only where there is none: the check below keeps this test from writing one into the repository.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: the baseline file of this repository
  expect(fs.existsSync(path.join(REPOSITORY, BASELINE_NAME))).toBe(true);
  expect(runFromElsewhere(tempDir(), ['--init'])).toEqual({
    status: 2,
    stdout: [''],
    stderr: [`${BASELINE_NAME} exists: use --force to overwrite`, ''],
  });
});
