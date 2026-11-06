// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterEach, expect, test, vi } from 'vitest';
import { FakeRenderWorker, installFakeRenderWorker } from '../../test-support/fake-render-worker.ts';
import { startRenderWorker } from './start-render-worker.ts';

// E18: the one place that starts the render worker. Where the browser has none, or refuses, the answer is "no worker".

/** What a browser does when a policy forbids the worker: the constructor throws. */
function BlockedWorker(): never {
  throw new DOMException('blocked', 'SecurityError');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('the worker is the module render-worker.ts of the app, started as a module', () => {
  installFakeRenderWorker();
  const worker = startRenderWorker();
  expect(worker).toBeInstanceOf(FakeRenderWorker);
  const [started] = FakeRenderWorker.instances;
  expect(String(started?.url)).toMatch(/\/render-worker\.ts(\?|$)/);
  expect(started?.options).toEqual({ type: 'module' });
  expect(FakeRenderWorker.instances).toHaveLength(1);
});

test('a browser with no workers gets no worker', () => {
  vi.stubGlobal('Worker', undefined);
  expect(startRenderWorker()).toBeUndefined();
});

test('a browser that refuses to start the worker gets no worker', () => {
  vi.stubGlobal('Worker', BlockedWorker);
  expect(startRenderWorker()).toBeUndefined();
});
