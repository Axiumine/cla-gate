// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { systemColorScheme } from '../test-support/theme.ts';
import {
  applyTheme,
  DEFAULT_THEME_MODE,
  isThemeMode,
  type ResolvedTheme,
  resolveTheme,
  systemPreference,
  THEME_MODES,
  type ThemeMode,
} from './model.ts';

// E17-S05: the theme modes, which theme each one shows, and how the page is told.

test('the modes are system, light and dark, and system is the default', () => {
  expect([...THEME_MODES]).toEqual(['system', 'light', 'dark']);
  expect(DEFAULT_THEME_MODE).toBe('system');
});

test.each(['system', 'light', 'dark'])('%s is a theme mode', (value) => {
  expect(isThemeMode(value)).toBe(true);
});

test.each([
  ['Dark'],
  ['LIGHT'],
  [' light'],
  ['auto'],
  [''],
  ['{"mode":"dark"}'],
  [null],
  [undefined],
  [1],
  [{}],
  [['dark']],
])('%j is not a theme mode', (value) => {
  expect(isThemeMode(value)).toBe(false);
});

test.each<[ThemeMode, boolean, ResolvedTheme]>([
  ['system', false, 'light'],
  ['system', true, 'dark'],
  ['light', false, 'light'],
  ['light', true, 'light'],
  ['dark', false, 'dark'],
  ['dark', true, 'dark'],
])('the mode %s with the system dark = %s shows the %s theme', (mode, systemDark, expected) => {
  expect(resolveTheme(mode, systemDark)).toBe(expected);
});

test('the system preference is the media query for dark, and tracks the system', () => {
  expect(systemPreference().media).toBe('(prefers-color-scheme: dark)');
  expect(systemPreference().matches).toBe(false);
  systemColorScheme.set(true);
  expect(systemPreference().matches).toBe(true);
});

test('applying a theme sets data-theme on <html>, replacing the one before', () => {
  applyTheme('dark');
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  applyTheme('light');
  expect(document.documentElement).toHaveAttribute('data-theme', 'light');
});
