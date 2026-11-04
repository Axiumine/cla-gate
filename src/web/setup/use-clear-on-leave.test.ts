// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { useClearOnLeave } from './use-clear-on-leave.ts';

// E19-S07: the credentials are dropped when the page is hidden and when the component goes.

test('it clears when the page is hidden, each time', () => {
  const clear = vi.fn();
  renderHook(() => {
    useClearOnLeave(clear);
  });
  expect(clear).not.toHaveBeenCalled();
  window.dispatchEvent(new Event('pagehide'));
  window.dispatchEvent(new Event('pagehide'));
  expect(clear).toHaveBeenCalledTimes(2);
});

test('it clears when the component unmounts, and listens no more afterwards', () => {
  const clear = vi.fn();
  const { unmount } = renderHook(() => {
    useClearOnLeave(clear);
  });
  unmount();
  expect(clear).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event('pagehide'));
  expect(clear).toHaveBeenCalledOnce();
});
