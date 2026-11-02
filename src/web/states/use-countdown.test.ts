// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useCountdown } from './use-countdown.ts';

// E17-S07: the countdown hook behind the 429 wait.

afterEach(() => {
  vi.useRealTimers();
});

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

test('it starts at the seconds it was given and counts down to zero, once a second', () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useCountdown(3, 'a'));
  expect(result.current).toBe(3);
  advance(1000);
  expect(result.current).toBe(2);
  advance(2000);
  expect(result.current).toBe(0);
  advance(5000);
  expect(result.current).toBe(0);
});

test('zero seconds is zero at once and starts nothing', () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useCountdown(0, 'a'));
  expect(result.current).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

test('a new key restarts the wait in the same render, with the seconds of the new wait', () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ seconds, key }) => useCountdown(seconds, key), {
    initialProps: { seconds: 3, key: 'a' },
  });
  advance(2000);
  expect(result.current).toBe(1);
  rerender({ seconds: 9, key: 'b' });
  expect(result.current).toBe(9);
  advance(1000);
  expect(result.current).toBe(8);
});

test('the same key keeps the wait going, and unmounting stops the timer', () => {
  vi.useFakeTimers();
  const { result, rerender, unmount } = renderHook(({ key }) => useCountdown(5, key), {
    initialProps: { key: 'a' },
  });
  advance(2000);
  rerender({ key: 'a' });
  expect(result.current).toBe(3);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
