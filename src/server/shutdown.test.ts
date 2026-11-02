// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, onTestFinished, test, vi } from 'vitest';
import { createLogger } from './adapters/http/logger.ts';
import { closeOnSignals, failExitOnAbortedStop } from './shutdown.ts';
import { captureLogs, FakeProcess, fakeJobQueue, freePort, testApp } from './test-support.ts';

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

/** A listening app with a route that never answers, and a client that is waiting for it. */
async function withStuckRequest() {
  const { install, ...rest } = await prepare();
  const arrived = Promise.withResolvers<undefined>();
  rest.app.get('/stuck', () => {
    arrived.resolve(undefined);
    return new Promise<never>(() => undefined);
  });
  const address = await rest.app.listen({ host: '127.0.0.1', port: await freePort() });
  const waiting = fetch(`${address}/stuck`).catch(() => 'dropped');
  await arrived.promise;
  return { ...rest, install, waiting };
}

test('a request that is still open at the deadline: the shutdown logs why it drops the connections, drops them and fails the exit code', async () => {
  const { logs, signals, dropped, install, waiting } = await withStuckRequest();
  install(SHORT);
  signals.emit('SIGINT');
  await vi.waitFor(() => {
    expect(dropped).toHaveBeenCalledOnce();
  });
  expect(await waiting).toBe('dropped');
  expect(signals.exitCode).toBe(1);
  expect(messages(logs)).toEqual([
    [30, 'shutting down'],
    [50, 'shutdown deadline exceeded, dropping open connections'],
  ]);
});

test('the deadline is about the requests: a close that goes on after the HTTP server has closed is not cut short (E07-S03)', async () => {
  const { app, logs, signals, dropped, install } = await prepare();
  // The job drain of a shutdown (the queue's own 30 s) runs in a close hook, after the HTTP server has closed.
  app.addHook('onClose', async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, SHORT * 6));
  });
  await app.listen({ host: '127.0.0.1', port: await freePort() });
  const close = install(SHORT);
  signals.emit('SIGTERM');
  await close();
  expect(dropped).not.toHaveBeenCalled();
  expect(signals.exitCode).toBeUndefined();
  expect(messages(logs)).toEqual([[30, 'shutting down']]);
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

test('a stop that drained leaves the exit code alone and logs nothing (E07-S03)', async () => {
  const logs = captureLogs();
  const signals = new FakeProcess();
  const queue = fakeJobQueue();
  const wrapped = failExitOnAbortedStop(queue, createLogger({ logLevel: 'info' }, logs.destination), signals);
  expect(await wrapped.stop()).toBe('drained');
  expect(signals.exitCode).toBeUndefined();
  expect(logs.lines()).toEqual([]);
  expect(queue.stops).toBe(1);
});

test('a stop that aborted running jobs logs it at error and ends the process with exit code 1 (E07-S03)', async () => {
  const logs = captureLogs();
  const signals = new FakeProcess();
  const queue = fakeJobQueue();
  queue.stopOutcome = 'aborted';
  const wrapped = failExitOnAbortedStop(queue, createLogger({ logLevel: 'info' }, logs.destination), signals);
  expect(await wrapped.stop()).toBe('aborted');
  expect(signals.exitCode).toBe(1);
  expect(messages(logs)).toEqual([
    [50, 'jobs still running at the end of the grace period were aborted, and run again after a restart'],
  ]);
});

test('the wrapped queue is the queue: its enqueuer and its readiness are the ones of the queue', async () => {
  const queue = fakeJobQueue();
  const wrapped = failExitOnAbortedStop(
    queue,
    createLogger({ logLevel: 'info' }, captureLogs().destination),
    new FakeProcess(),
  );
  expect(wrapped.enqueuer).toBe(queue.enqueuer);
  queue.ready = false;
  expect(await wrapped.isReady()).toBe(false);
  queue.ready = true;
  expect(await wrapped.isReady()).toBe(true);
});
