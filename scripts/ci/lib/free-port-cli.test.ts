// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { runFreePortCli } from './free-port-cli.ts';
import { PORT_MAX, PORT_MIN, PortError } from './ports.ts';
import { collectIo } from './test-support.ts';

test('prints the picked port as the only output and exits 0', async () => {
  const { io, out, err } = collectIo();
  expect(await runFreePortCli(io, () => Promise.resolve(41_234))).toBe(0);
  expect(out).toEqual(['41234']);
  expect(err).toEqual([]);
});

test('reports a failure on stderr, prints nothing on stdout and exits 1', async () => {
  const { io, out, err } = collectIo();
  const pick = () => Promise.reject(new PortError('no free port in 32769..60999 after 50 attempts'));
  expect(await runFreePortCli(io, pick)).toBe(1);
  expect(out).toEqual([]);
  expect(err).toEqual(['free-port: no free port in 32769..60999 after 50 attempts']);
});

test('by default it picks a real free port inside the range', async () => {
  const { io, out } = collectIo();
  expect(await runFreePortCli(io)).toBe(0);
  expect(out).toHaveLength(1);
  expect(Number(out[0])).toBeGreaterThanOrEqual(PORT_MIN);
  expect(Number(out[0])).toBeLessThanOrEqual(PORT_MAX);
});
