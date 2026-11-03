// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Mock, vi } from 'vitest';

// A full-page navigation, seen instead of attempted (E17-S08). jsdom cannot load another page: it prints "not implemented:
// navigation" and goes nowhere. A test that expects the app to leave the page replaces `location` with a copy whose `assign`
// is a spy; the copy keeps the address the page had.

/**
 * Replaces `window.location` with a copy whose `assign` records its argument. Returns the spy. Undo with
 * `vi.unstubAllGlobals()`, which a test that calls this does after each test.
 */
export function spyOnPageNavigation(): Mock<(address: string) => void> {
  const assign = vi.fn<(address: string) => void>();
  vi.stubGlobal('location', Object.assign({}, window.location, { assign }));
  return assign;
}
