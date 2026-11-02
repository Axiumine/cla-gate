// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, onTestFinished, test, vi } from 'vitest';
import { createLogger } from './adapters/http/logger.ts';
import { closeOnSignals } from './shutdown.ts';
import { captureLogs, FakeProcess, testApp } from './test-support.ts';

// closeOnSignals() on a real app, with the log captured: what the operator reads when a shutdown goes well, badly or twice.

const SHORT = 30;

async function prepare() {
  const { app } = await testApp();
  const logs = captureLogs();
  const signals = new FakeProcess();
  const dropped = vi.spyOn(app.server, 'closeAllConnections');
  const install = (timeoutMs: number) =>
    closeOnSignals(app, createLogger({ logLevel: 'info' }, logs.destination), signals, timeoutMs);
  return { app, logs, signals, dropped, install };
}

async function setup(timeoutMs = SHORT) {
  const { install, ...rest } = await prepare();
  return { ...rest, close: install(timeoutMs) };
}

/** An app whose close() hangs until the test is over (the hook is released before the test's own cleanup closes the app). */
function neverClosing(app: Awaited<ReturnType<typeof testApp>>['app']): void {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  app.addHook('onClose', async () => {
    await gate;
  });
  onTestFinished(() => {
    release();
  });
}

/** The messages logged so far, with their level. */
const messages = (logs: ReturnType<typeof captureLogs>) => logs.lines().map((line) => [line['level'], line['msg']]);

test('a signal logs that the shutdown starts, closes the app once and leaves the exit code alone', async () => {
  const { app, logs, signals, close } = await setup();
  const closing = vi.spyOn(app, 'close');
  signals.emit('SIGTERM');
  await close();
  expect(closing).toHaveBeenCalledOnce();
  expect(messages(logs)).toEqual([[30, 'shutting down']]);
  expect(signals.exitCode).toBeUndefined();
});

test('a shutdown that outlasts its deadline logs why it drops the connections, drops them and fails the exit code', async () => {
  const { app, logs, signals, dropped } = await setup();
  neverClosing(app);
  signals.emit('SIGINT');
  await vi.waitFor(() => {
    expect(dropped).toHaveBeenCalledOnce();
  });
  expect(signals.exitCode).toBe(1);
  expect(messages(logs)).toEqual([
    [30, 'shutting down'],
    [50, 'shutdown deadline exceeded, dropping open connections'],
  ]);
});

test('a second signal logs that it drops the connections at once', async () => {
  const { app, logs, signals, dropped } = await setup(600_000);
  neverClosing(app);
  signals.emit('SIGTERM');
  signals.emit('SIGINT');
  expect(dropped).toHaveBeenCalledOnce();
  expect(signals.exitCode).toBe(1);
  expect(messages(logs)).toEqual([
    [30, 'shutting down'],
    [50, 'second signal, dropping open connections'],
  ]);
});

test('a failing close is logged with the error and sets the exit code', async () => {
  const { app, logs, signals, close } = await setup();
  vi.spyOn(app, 'close').mockRejectedValueOnce(new Error('destroy failed'));
  await close();
  expect(signals.exitCode).toBe(1);
  expect(logs.lines()).toMatchObject([{ level: 50, msg: 'shutdown failed', err: { message: 'destroy failed' } }]);
});

test('a shutdown that finishes in time cancels the deadline: nothing is dropped and the exit code stays clean', async () => {
  const { app, logs, signals, dropped, install } = await prepare();
  // Registered after the app's own cleanup, so the real timers are back before that cleanup closes the app.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const close = install(SHORT);
  vi.spyOn(app, 'close').mockReturnValue(undefined);
  await close();
  vi.advanceTimersByTime(SHORT * 10);
  expect(dropped).not.toHaveBeenCalled();
  expect(signals.exitCode).toBeUndefined();
  expect(logs.lines()).toEqual([]);
});
