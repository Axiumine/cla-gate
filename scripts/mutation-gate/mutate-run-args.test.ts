// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { EventEmitter } from 'node:events';
import path from 'node:path';
import process from 'node:process';
import { afterEach, expect, test, vi } from 'vitest';
import { ROOT } from '../semgrep-rules/test-support.ts';
import { STRYKER_NODE_ARGS } from './node-args.ts';

// E20-S04: what the main process of a Stryker run is started with. The flag is the one that keeps Stryker's messages to its
// checker, which can be hundreds of megabytes, from aborting Node 26 (node-args.ts has the reason). The real process runs in
// mutate-run.test.ts; here `spawn` is a fake, so the arguments themselves can be read.

afterEach(() => {
  vi.doUnmock('node:child_process');
  vi.resetModules();
});

test('Stryker starts under this Node with the flag of node-args.ts before its entry point, then the arguments of the caller', async () => {
  const spawn = vi.fn(() => {
    const child = new EventEmitter<{ close: [number] }>();
    queueMicrotask(() => child.emit('close', 0));
    return child;
  });
  vi.doMock('node:child_process', () => ({ spawn }));
  vi.resetModules();
  const { systemDeps } = await import('./mutate-run.ts');
  const outcome = await systemDeps.run(['run', '--incremental', '--force'], { STRYKER_SHARD: 'http-a-v' }, undefined);
  expect(outcome).toEqual({ code: 0, timedOut: false });
  expect(spawn).toHaveBeenCalledExactlyOnceWith(
    process.execPath,
    [
      '--no-json-stringify-fast-path',
      path.join(ROOT, 'node_modules/@stryker-mutator/core/bin/stryker.js'),
      'run',
      '--incremental',
      '--force',
    ],
    expect.objectContaining({ cwd: ROOT, env: { STRYKER_SHARD: 'http-a-v' } }),
  );
  expect(STRYKER_NODE_ARGS).toEqual(['--no-json-stringify-fast-path']);
});
