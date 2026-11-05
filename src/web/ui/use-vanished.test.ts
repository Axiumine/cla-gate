// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { useVanished } from './use-vanished.ts';

// E18-S07, E18-S08: the callback runs when the component goes away after the revocation went through, and for no other reason.

test('it runs nothing while the component is there, settled or not', () => {
  const onVanished = vi.fn<() => void>();
  const { result } = renderHook(() => useVanished(onVanished));
  result.current();
  expect(onVanished).not.toHaveBeenCalled();
});

test('a component that unmounts with no revocation settled runs nothing', () => {
  const onVanished = vi.fn<() => void>();
  const { unmount } = renderHook(() => useVanished(onVanished));
  unmount();
  expect(onVanished).not.toHaveBeenCalled();
});

test('a component that unmounts after the revocation settled runs the callback once', () => {
  const onVanished = vi.fn<() => void>();
  const { result, unmount } = renderHook(() => useVanished(onVanished));
  result.current();
  unmount();
  expect(onVanished).toHaveBeenCalledTimes(1);
});

test('the callback that runs is the latest one given, not the one of the first render', () => {
  const first = vi.fn<() => void>();
  const second = vi.fn<() => void>();
  const { result, rerender, unmount } = renderHook(({ callback }) => useVanished(callback), {
    initialProps: { callback: first },
  });
  result.current();
  rerender({ callback: second });
  unmount();
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
});
