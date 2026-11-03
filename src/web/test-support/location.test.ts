// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterEach, expect, test, vi } from 'vitest';
import { spyOnPageNavigation } from './location.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('assign is recorded instead of attempted, and the page keeps the address it had', () => {
  window.history.replaceState(null, '', '/somewhere?x=1');
  const assign = spyOnPageNavigation();
  window.location.assign('/api/auth/login');
  expect(assign).toHaveBeenCalledExactlyOnceWith('/api/auth/login');
  expect(window.location.pathname + window.location.search).toBe('/somewhere?x=1');
});

test('after the stub is removed the real location is back', () => {
  spyOnPageNavigation();
  vi.unstubAllGlobals();
  expect(vi.isMockFunction(Reflect.get(window.location, 'assign'))).toBe(false);
});
