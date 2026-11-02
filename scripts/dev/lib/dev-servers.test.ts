// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import process from 'node:process';
import { expect, test } from 'vitest';
import { collectIo } from '../../ci/lib/test-support.ts';
import { type Context, runDevServers, type ServersDeps } from './dev-servers.ts';
import type { Child } from './dev-supervise.ts';

const ROOT = path.resolve('/repo');
const VITE = path.join(ROOT, 'node_modules/vite/bin/vite.js');

/** A child that ends when the test says so, and records the signals it was sent. */
function fakeChild(): Child & { signals: NodeJS.Signals[]; end: (code: number) => void } {
  const signals: NodeJS.Signals[] = [];
  const ended = Promise.withResolvers<number>();
  return { signals, end: ended.resolve, done: ended.promise, stop: (signal) => signals.push(signal) };
}

/** Fake dependencies: the ports come from `ports`, `start` hands out fake children and `onStop` keeps the handler. */
function world(ports: number[] = [41_000]) {
  const children = new Map<string, ReturnType<typeof fakeChild>>();
  const started: [string, readonly string[], Readonly<Record<string, string>>][] = [];
  const stopHandlers: ((signal: NodeJS.Signals) => void)[] = [];
  const unsubscribed: string[] = [];
  const deps: ServersDeps = {
    pickPort: () => Promise.resolve(ports.shift() ?? 0),
    start: (command, args, env) => {
      const child = fakeChild();
      children.set(args.includes('--watch') ? 'app' : 'vite', child);
      started.push([command, args, env]);
      return child;
    },
    onStop: (handler) => {
      stopHandlers.push(handler);
      return () => unsubscribed.push('onStop');
    },
  };
  const { io, out, err } = collectIo();
  const run = (env: Record<string, string>): Promise<number> => {
    const context: Context = { root: ROOT, env, deps, io };
    return runDevServers(context);
  };
  const app = () => children.get('app');
  const vite = () => children.get('vite');
  /** Both children end (a child that has ended already stays as it was), so a run that waits for them finishes. */
  const endAll = (code: number) => {
    app()?.end(code);
    vite()?.end(code);
  };
  return { run, started, out, err, stopHandlers, unsubscribed, app, vite, endAll };
}

/** Lets the pending promises run: the servers are started after a port has been picked. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('the app and Vite start side by side, Vite on a port of its own and the app on the one db.ts picked', async () => {
  const w = world([41_000]);
  const finished = w.run({ PORT: '45000' });
  await settle();
  expect(w.started).toEqual([
    [process.execPath, ['--watch', 'src/server/main.ts'], { PUBLIC_BASE_URL: 'http://localhost:41000' }],
    [process.execPath, [VITE, '--host', '127.0.0.1', '--port', '41000', '--strictPort'], {}],
  ]);
  expect(w.out).toEqual([
    'web: http://localhost:41000 (Vite on 127.0.0.1:41000; forwards /api, /healthz and /readyz to the app on port 45000)',
  ]);
  w.endAll(0);
  await finished;
});

test.each([
  ['an address the person chose', { PUBLIC_BASE_URL: 'https://tunnel.example' }],
  ['an address the person chose, next to a port', { PUBLIC_BASE_URL: 'http://localhost:9', HOST: '0.0.0.0' }],
])('PUBLIC_BASE_URL is left alone when set: %s', async (_what, extra) => {
  const w = world();
  const finished = w.run({ PORT: '45000', ...extra });
  await settle();
  expect(w.started[0]?.[2]).toEqual({});
  w.endAll(0);
  await finished;
});

test('an empty PUBLIC_BASE_URL counts as unset', async () => {
  const w = world();
  const finished = w.run({ PORT: '45000', PUBLIC_BASE_URL: '' });
  await settle();
  expect(w.started[0]?.[2]).toEqual({ PUBLIC_BASE_URL: 'http://localhost:41000' });
  w.endAll(0);
  await finished;
});

test('Vite never gets the port of the app, even when the draw repeats it', async () => {
  const w = world([45_000, 45_000, 41_234]);
  const finished = w.run({ PORT: '45000' });
  await settle();
  expect(w.started[1]?.[1]).toContain('41234');
  expect(w.out[0]).toContain('http://localhost:41234');
  w.endAll(0);
  await finished;
});

test.each([
  ['no PORT', {}],
  ['an empty PORT', { PORT: '' }],
  ['a PORT that is not a number', { PORT: 'abc' }],
  ['a PORT with a second number', { PORT: '4500 4501' }],
])('%s starts nothing and fails', async (_what, env) => {
  const w = world();
  expect(await w.run(env)).toBe(1);
  expect(w.started).toEqual([]);
  expect(w.err).toEqual(['dev: PORT is not set, so the app has no port to listen on: run `yarn dev`, which picks one']);
  expect(w.stopHandlers).toEqual([]);
});

test("when the app dies, Vite is stopped and the run fails with the app's code", async () => {
  const w = world();
  const finished = w.run({ PORT: '45000' });
  await settle();
  w.app()?.end(3);
  await settle();
  expect(w.vite()?.signals).toEqual(['SIGTERM']);
  expect(w.app()?.signals).toEqual(['SIGTERM']);
  w.vite()?.end(143);
  expect(await finished).toBe(3);
  expect(w.err).toEqual(['dev: the app exited with code 3: stopping the other dev server']);
  expect(w.unsubscribed).toEqual(['onStop']);
});

test('when Vite dies, the app is stopped and the run fails', async () => {
  const w = world();
  const finished = w.run({ PORT: '45000' });
  await settle();
  w.vite()?.end(2);
  await settle();
  expect(w.app()?.signals).toEqual(['SIGTERM']);
  w.app()?.end(143);
  expect(await finished).toBe(2);
  expect(w.err).toEqual(['dev: Vite exited with code 2: stopping the other dev server']);
});

test('a server that exits with 0 is still a failed run: nobody asked it to stop', async () => {
  const w = world();
  const finished = w.run({ PORT: '45000' });
  await settle();
  w.vite()?.end(0);
  await settle();
  w.app()?.end(0);
  expect(await finished).toBe(1);
  expect(w.err).toEqual(['dev: Vite exited with code 0: stopping the other dev server']);
});

test.each(['SIGINT', 'SIGTERM'] as const)('%s stops both servers, waits for them and exits 0', async (signal) => {
  const w = world();
  const finished = w.run({ PORT: '45000' });
  await settle();
  expect(w.stopHandlers).toHaveLength(1);
  w.stopHandlers[0]?.(signal);
  expect(w.app()?.signals).toEqual([signal]);
  expect(w.vite()?.signals).toEqual([signal]);
  expect(w.unsubscribed).toEqual([]);
  w.app()?.end(130);
  await settle();
  w.vite()?.end(130);
  expect(await finished).toBe(0);
  expect(w.err).toEqual([]);
  expect(w.unsubscribed).toEqual(['onStop']);
});
