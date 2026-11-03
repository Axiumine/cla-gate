// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterEach, expect, test, vi } from 'vitest';
import { readThemeMode, writeThemeMode } from './storage.ts';

// E17-S05: the choice of theme, kept under one key, and the app working when storage does not.

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

test('with nothing stored the mode is system', () => {
  expect(readThemeMode()).toBe('system');
});

test.each(['system', 'light', 'dark'] as const)('a stored %s is the mode', (mode) => {
  localStorage.setItem('cla.theme', mode);
  expect(readThemeMode()).toBe(mode);
});

test.each(['Dark', 'blue', '', ' light', '"dark"', '{"theme":"dark"}', 'null', 'undefined', 'dark\n'])(
  'a stored %j is not a mode: the mode is system, and the entry is left as it was',
  (stored) => {
    localStorage.setItem('cla.theme', stored);
    expect(readThemeMode()).toBe('system');
    expect(localStorage.getItem('cla.theme')).toBe(stored);
    expect(localStorage).toHaveLength(1);
  },
);

test('reading never writes: a first visit leaves storage empty', () => {
  expect(readThemeMode()).toBe('system');
  expect(localStorage).toHaveLength(0);
  expect(sessionStorage).toHaveLength(0);
});

test.each(['system', 'light', 'dark'] as const)(
  'writing %s stores that name under cla.theme and nothing else',
  (mode) => {
    writeThemeMode(mode);
    expect(localStorage.getItem('cla.theme')).toBe(mode);
    expect(Object.keys(localStorage)).toEqual(['cla.theme']);
    expect(sessionStorage).toHaveLength(0);
  },
);

test('a later choice replaces the earlier one under the same key', () => {
  writeThemeMode('dark');
  writeThemeMode('light');
  expect(Object.entries(localStorage)).toEqual([['cla.theme', 'light']]);
  expect(readThemeMode()).toBe('light');
});

test('what is written is read back as the same mode', () => {
  writeThemeMode('dark');
  expect(readThemeMode()).toBe('dark');
});

test('when reading storage throws, the mode is system', () => {
  localStorage.setItem('cla.theme', 'dark');
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError');
  });
  expect(readThemeMode()).toBe('system');
});

test('when storage is not reachable at all (the property itself throws), the mode is system and writing does not throw', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError');
  });
  expect(readThemeMode()).toBe('system');
  expect(() => {
    writeThemeMode('dark');
  }).not.toThrow();
});

test('when writing throws (a full or blocked storage), nothing is raised and nothing is stored', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('full', 'QuotaExceededError');
  });
  expect(() => {
    writeThemeMode('dark');
  }).not.toThrow();
  expect(localStorage).toHaveLength(0);
});
