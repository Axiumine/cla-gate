// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect } from 'vitest';
import { CSRF_TOKEN } from './session.ts';

/**
 * The session token is held in the query cache and nowhere else: nothing in Web Storage, no cookie the page can read,
 * nothing in the markup and nothing in the address (E17-S04, E17-S08). The console is checked where the spies are.
 */
export function expectNoTokenInTheBrowser(): void {
  expect(localStorage).toHaveLength(0);
  expect(sessionStorage).toHaveLength(0);
  expect(document.cookie).toBe('');
  expect(document.documentElement.outerHTML).not.toContain(CSRF_TOKEN);
  expect(window.location.href).not.toContain(CSRF_TOKEN);
}
