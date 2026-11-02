// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterEach, expect, test, vi } from 'vitest';
import { systemColorScheme } from '../test-support/theme.ts';

// E17-S05: the script of <head> that sets data-theme before the first paint. Importing it runs it, so each case imports it
// afresh, after setting up the page it would find.

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

/** Runs the script on the page as it is now, and returns the theme it left on <html>. */
async function runScript(): Promise<string | null> {
  vi.resetModules();
  await import('./theme-init.ts');
  return document.documentElement.getAttribute('data-theme');
}

test.each([
  ['nothing is stored and the system is light', null, false, 'light'],
  ['nothing is stored and the system is dark', null, true, 'dark'],
  ['system is stored and the system is dark', 'system', true, 'dark'],
  ['light is stored and the system is dark', 'light', true, 'light'],
  ['dark is stored and the system is light', 'dark', false, 'dark'],
  ['something else is stored and the system is dark', 'purple', true, 'dark'],
])('when %s, data-theme is %s', async (_case, stored, systemDark, expected) => {
  if (stored !== null) {
    localStorage.setItem('cla.theme', stored);
  }
  systemColorScheme.set(systemDark);
  expect(await runScript()).toBe(expected);
});

test('when storage throws, the script still sets the theme the system prefers', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError');
  });
  systemColorScheme.set(true);
  expect(await runScript()).toBe('dark');
});

test('the script replaces a theme that was on the page and writes nothing to storage', async () => {
  document.documentElement.setAttribute('data-theme', 'dark');
  expect(await runScript()).toBe('light');
  expect(localStorage).toHaveLength(0);
});

test('the script does its work while it is evaluated, not later: the theme is set before anything else can run', async () => {
  let atImport: string | null = null;
  vi.resetModules();
  const loaded = import('./theme-init.ts').then(() => {
    atImport = document.documentElement.getAttribute('data-theme');
  });
  await loaded;
  expect(atImport).toBe('light');
});
