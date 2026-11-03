// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { expect, test, vi } from 'vitest';
import { pickSystemFreePort } from '../../ci/lib/ports.ts';
import { onStopSignal, spawnChild, systemServersDeps } from './dev-children.ts';

const WAIT_FOREVER = 'setInterval(() => {}, 1000)';

test('the real dependencies are the system port probe, the child spawner and the process signals', () => {
  expect(systemServersDeps).toEqual({ pickPort: pickSystemFreePort, start: spawnChild, onStop: onStopSignal });
});

test('a child resolves with its own exit code', async () => {
  expect(await spawnChild(process.execPath, ['-e', 'process.exit(5)'], {}).done).toBe(5);
  expect(await spawnChild(process.execPath, ['-e', 'process.exit(0)'], {}).done).toBe(0);
});

test('the child gets the added environment, and this process does not', async () => {
  const program = 'process.exit(process.env.CLA_DEV_CHILD === "yes" ? 0 : 9)';
  expect(await spawnChild(process.execPath, ['-e', program], { CLA_DEV_CHILD: 'yes' }).done).toBe(0);
  expect(process.env['CLA_DEV_CHILD']).toBeUndefined();
});

test('a command that does not exist ends with 127', async () => {
  expect(await spawnChild('definitely-not-a-real-binary-cla', [], {}).done).toBe(127);
});

test.each([
  ['SIGTERM', 143],
  ['SIGINT', 130],
] as const)('stop(%s) ends a running child with 128 plus the signal number', async (signal, code) => {
  const child = spawnChild(process.execPath, ['-e', WAIT_FOREVER], {});
  child.stop(signal);
  expect(await child.done).toBe(code);
});

test('stopping a child that has already ended is harmless', async () => {
  const child = spawnChild(process.execPath, ['-e', 'process.exit(4)'], {});
  expect(await child.done).toBe(4);
  child.stop('SIGTERM');
  expect(await child.done).toBe(4);
});

test.each(['SIGINT', 'SIGTERM'] as const)(
  '%s reaches the handler with its name, and the listener goes away',
  (signal) => {
    const counts = () => [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    const before = counts();
    const handler = vi.fn();
    const remove = onStopSignal(handler);
    expect(counts()).toEqual(before.map((count) => count + 1));
    process.emit(signal);
    expect(handler).toHaveBeenCalledExactlyOnceWith(signal);
    remove();
    expect(counts()).toEqual(before);
    process.emit(signal);
    expect(handler).toHaveBeenCalledTimes(1);
  },
);
