// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { afterEach, expect, test, vi } from 'vitest';

// E20-S04: scripts/mutation-gate/mutate.ts only wires the arguments, the environment, the streams and the real process
// runner into runMutateCli, and turns its result into the exit code.

afterEach(() => {
  process.exitCode = undefined;
  vi.doUnmock('./mutate-cli.ts');
  vi.resetModules();
  vi.restoreAllMocks();
});

test('mutate hands its arguments, the environment, the streams and the real runner to the CLI and exits with its code', async () => {
  const runMutateCli = vi.fn(() => Promise.resolve(1));
  vi.doMock('./mutate-cli.ts', () => ({ runMutateCli }));
  const argv = process.argv;
  vi.resetModules();
  process.argv = ['node', 'mutate.ts', 'shared', '--force'];
  try {
    await import('./mutate.ts');
  } finally {
    process.argv = argv;
  }
  const { stdIo } = await import('../ci/lib/io.ts');
  const { systemDeps } = await import('./mutate-run.ts');
  expect(runMutateCli).toHaveBeenCalledExactlyOnceWith(['shared', '--force'], process.env, stdIo, systemDeps);
  expect(process.exitCode).toBe(1);
});
