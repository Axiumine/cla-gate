// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import process from 'node:process';
import { afterEach, expect, test, vi } from 'vitest';
import { ROOT } from '../semgrep-rules/test-support.ts';

// E20-S04: scripts/mutation-gate/check-incremental.ts only wires the environment, the streams and the repository root into
// runCheckIncremental, and turns its result into the exit code.

afterEach(() => {
  process.exitCode = undefined;
  vi.doUnmock('./incremental-file.ts');
  vi.resetModules();
  vi.restoreAllMocks();
});

test('check-incremental hands the environment, the streams and the repository root to the check and exits with its code', async () => {
  const runCheckIncremental = vi.fn(() => 2);
  vi.doMock('./incremental-file.ts', () => ({ runCheckIncremental }));
  vi.resetModules();
  await import('./check-incremental.ts');
  const { stdIo } = await import('../ci/lib/io.ts');
  expect(runCheckIncremental).toHaveBeenCalledExactlyOnceWith(process.env, stdIo, path.resolve(ROOT));
  expect(process.exitCode).toBe(2);
});
