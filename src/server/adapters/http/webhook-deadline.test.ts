// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { AppError } from './errors.ts';
import { WEBHOOK_DEADLINE_MS, withDeadline } from './webhook-deadline.ts';

// The 8 second deadline of the webhook handler (E06-S07), on fake timers: the exact instant it fires, what it aborts,
// and that it leaves nothing behind.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const timeout = new AppError(503, 'webhook_timeout');

test('the deadline is 8 seconds, two inside the 10 that GitHub gives a delivery', () => {
  expect(WEBHOOK_DEADLINE_MS).toBe(8000);
});

test('work that finishes in time gives its result and leaves no timer behind', async () => {
  const result = await withDeadline(WEBHOOK_DEADLINE_MS, () => Promise.resolve('done'));
  expect(result).toBe('done');
  expect(vi.getTimerCount()).toBe(0);
});

test('work that fails in time gives its own error and leaves no timer behind', async () => {
  const failure = new Error('the database is down');
  await expect(withDeadline(WEBHOOK_DEADLINE_MS, () => Promise.reject(failure))).rejects.toBe(failure);
  expect(vi.getTimerCount()).toBe(0);
});

test('work still running at the budget is a 503 webhook_timeout, not a millisecond earlier', async () => {
  const outcome = withDeadline(WEBHOOK_DEADLINE_MS, () => new Promise<never>(() => undefined)).then(
    () => 'finished',
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(WEBHOOK_DEADLINE_MS - 1);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await outcome).toMatchObject({ status: 503, code: timeout.code });
  expect(vi.getTimerCount()).toBe(0);
});

test('the signal aborts at the deadline and not before, so the work can stop at its next step', async () => {
  let seen: AbortSignal | undefined;
  const outcome = withDeadline(1000, (signal) => {
    seen = signal;
    return new Promise<never>(() => undefined);
  }).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(999);
  expect(seen?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(seen?.aborted).toBe(true);
  expect(await outcome).toBeInstanceOf(AppError);
});

test('work that stops at the signal after the deadline is not an unhandled rejection', async () => {
  const stopped = Promise.withResolvers<never>();
  const outcome = withDeadline(1000, () => stopped.promise).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(1000);
  stopped.reject(new Error('stopped at the signal'));
  expect(await outcome).toMatchObject({ code: 'webhook_timeout' });
});

test('a budget that is already spent expires at once', async () => {
  const outcome = withDeadline(-5, () => new Promise<never>(() => undefined)).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(1);
  expect(await outcome).toMatchObject({ status: 503, code: 'webhook_timeout' });
});

test('work that finishes after the deadline cannot turn the answer back into a success', async () => {
  const late = Promise.withResolvers<string>();
  const outcome = withDeadline(1000, () => late.promise).then(
    (value) => value,
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(1000);
  late.resolve('too late');
  expect(await outcome).toMatchObject({ code: 'webhook_timeout' });
});
