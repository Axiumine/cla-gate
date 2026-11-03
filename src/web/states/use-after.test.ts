// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useAfter } from './use-after.ts';

// E17-S07: the delay hook behind the spinner.

afterEach(() => {
  vi.useRealTimers();
});

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

test('it is false until the delay has passed, then true', () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useAfter(200));
  expect(result.current).toBe(false);
  advance(199);
  expect(result.current).toBe(false);
  advance(1);
  expect(result.current).toBe(true);
});

test('unmounting before the delay cancels the timer', () => {
  vi.useFakeTimers();
  const { unmount } = renderHook(() => useAfter(200));
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
