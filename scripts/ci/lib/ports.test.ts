// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import net from 'node:net';
import { expect, test, vi } from 'vitest';
import { isPortFree, PORT_MAX, PORT_MIN, PortError, pickFreePort, pickSystemFreePort, withFreePort } from './ports.ts';

/** Listens on a loopback port of our own range until the returned function is called. */
async function occupyPort(): Promise<{ port: number; release: () => Promise<void> }> {
  const server = net.createServer();
  const port = await pickSystemFreePort();
  await new Promise<void>((resolve) => {
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    port,
    release: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

test('the range is above 32768 and below the end of the usual ephemeral range', () => {
  expect([PORT_MIN, PORT_MAX]).toEqual([32_769, 60_999]);
});

test('the first free draw wins, and the random source is asked for the whole range', async () => {
  const randomInt = vi.fn(() => 40_000);
  const isFree = vi.fn(() => Promise.resolve(true));
  expect(await pickFreePort({ randomInt, isFree })).toBe(40_000);
  expect(randomInt).toHaveBeenCalledExactlyOnceWith(32_769, 60_999);
  expect(isFree).toHaveBeenCalledExactlyOnceWith(40_000);
});

test('taken ports are skipped until a free one turns up', async () => {
  const draws = [33_000, 33_001, 33_002];
  const randomInt = () => draws.shift() ?? 0;
  const isFree = vi.fn((port: number) => Promise.resolve(port === 33_002));
  expect(await pickFreePort({ randomInt, isFree })).toBe(33_002);
  expect(isFree.mock.calls).toEqual([[33_000], [33_001], [33_002]]);
});

test.each([
  ['the default of 50', undefined, 50],
  ['an explicit 3', 3, 3],
])('gives up with a PortError after %s attempts', async (_what, attempts, expected) => {
  const isFree = vi.fn(() => Promise.resolve(false));
  const options =
    attempts === undefined ? { randomInt: () => 40_000, isFree } : { randomInt: () => 40_000, isFree, attempts };
  await expect(pickFreePort(options)).rejects.toThrow(
    new PortError(`no free port in 32769..60999 after ${expected} attempts`),
  );
  expect(isFree).toHaveBeenCalledTimes(expected);
});

test.each([[32_768], [61_000], [40_000.5], [Number.NaN], [0]])(
  'rejects the random draw %s as out of range',
  async (draw) => {
    const isFree = vi.fn(() => Promise.resolve(true));
    await expect(pickFreePort({ randomInt: () => draw, isFree })).rejects.toThrow(PortError);
    expect(isFree).not.toHaveBeenCalled();
  },
);

test('the real probe sees a port that is in use and one that is not', async () => {
  const { port, release } = await occupyPort();
  expect(await isPortFree(port)).toBe(false);
  await release();
  expect(await isPortFree(port)).toBe(true);
});

test('the real picker returns a loopback-bindable port inside the range', async () => {
  const port = await pickSystemFreePort();
  expect(port).toBeGreaterThanOrEqual(PORT_MIN);
  expect(port).toBeLessThanOrEqual(PORT_MAX);
  expect(await isPortFree(port)).toBe(true);
});

test('a start that works on the first port is not retried', async () => {
  const run = vi.fn(() => Promise.resolve({ code: 0, stderr: '' }));
  const reset = vi.fn(() => Promise.resolve());
  const result = await withFreePort({ pickPort: () => Promise.resolve(41_000), run, reset, attempts: 3 });
  expect(result).toEqual({ port: 41_000, result: { code: 0, stderr: '' } });
  expect(reset).not.toHaveBeenCalled();
});

test.each([
  ['Docker run', 'Bind for 127.0.0.1:41000 failed: port is already allocated'],
  ['the userland proxy', 'Error starting userland proxy: listen tcp4 127.0.0.1:41000: bind: address already in use'],
  ['Compose', 'Ports are not available: exposing port TCP 127.0.0.1:41000 -> 127.0.0.1:0'],
])('a port lost to a race (%s) is reset and retried with a new one', async (_who, stderr) => {
  const ports = [41_000, 41_001];
  const run = vi.fn((port: number) =>
    Promise.resolve(port === 41_000 ? { code: 125, stderr } : { code: 0, stderr: '' }),
  );
  const reset = vi.fn(() => Promise.resolve());
  const result = await withFreePort({ pickPort: () => Promise.resolve(ports.shift() ?? 0), run, reset, attempts: 3 });
  expect(result.port).toBe(41_001);
  expect(reset).toHaveBeenCalledExactlyOnceWith(41_000);
});

test('any other failure is handed back at once, without a retry', async () => {
  const failure = { code: 125, stderr: 'pull access denied' };
  const run = vi.fn(() => Promise.resolve(failure));
  const reset = vi.fn(() => Promise.resolve());
  const result = await withFreePort({ pickPort: () => Promise.resolve(41_000), run, reset, attempts: 3 });
  expect(result).toEqual({ port: 41_000, result: failure });
  expect(run).toHaveBeenCalledOnce();
  expect(reset).not.toHaveBeenCalled();
});

test('a port that is lost every time ends in a PortError, with the last attempt reset too', async () => {
  const run = vi.fn(() => Promise.resolve({ code: 125, stderr: 'port is already allocated' }));
  const reset = vi.fn(() => Promise.resolve());
  const attempt = withFreePort({ pickPort: () => Promise.resolve(41_000), run, reset, attempts: 2 });
  await expect(attempt).rejects.toThrow(new PortError('the chosen port was taken 2 times in a row'));
  expect(reset).toHaveBeenCalledTimes(2);
});
