// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { resetThemeEnvironment, systemColorScheme } from './theme.ts';

// E17-S05: the stand-in for what jsdom lacks, which the theme tests rely on.

const DARK = '(prefers-color-scheme: dark)';
const LIGHT = '(prefers-color-scheme: light)';

test('every test starts on a light system', () => {
  expect(systemColorScheme.dark).toBe(false);
  expect(window.matchMedia(DARK).matches).toBe(false);
  expect(window.matchMedia(LIGHT).matches).toBe(true);
});

test('a media query list reports its own query', () => {
  expect(window.matchMedia(DARK).media).toBe(DARK);
});

test.each([
  ['(prefers-color-scheme: no-preference)'],
  ['(prefers-reduced-motion: reduce)'],
  ['(prefers-color-scheme:dark) and (min-width: 1px)'],
  [''],
])('a query the stand-in does not model (%j) never matches', (query) => {
  systemColorScheme.set(true);
  expect(window.matchMedia(query).matches).toBe(false);
});

test('switching the system to dark changes what the queries match', () => {
  systemColorScheme.set(true);
  expect(systemColorScheme.dark).toBe(true);
  expect(window.matchMedia(DARK).matches).toBe(true);
  expect(window.matchMedia(LIGHT).matches).toBe(false);
});

test('a listener hears the change once per switch, and only when the answer to its query changed', () => {
  const dark = window.matchMedia(DARK);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const heardDark = vi.fn();
  const heardReduced = vi.fn();
  dark.addEventListener('change', heardDark);
  reduced.addEventListener('change', heardReduced);
  systemColorScheme.set(true);
  systemColorScheme.set(true);
  systemColorScheme.set(false);
  expect(heardDark).toHaveBeenCalledTimes(2);
  expect(heardReduced).not.toHaveBeenCalled();
});

test('a listener that was removed hears nothing', () => {
  const dark = window.matchMedia(DARK);
  const heard = vi.fn();
  dark.addEventListener('change', heard);
  dark.removeEventListener('change', heard);
  systemColorScheme.set(true);
  expect(heard).not.toHaveBeenCalled();
});

test('the reset puts the page back to a first visit on a light system', () => {
  const dark = window.matchMedia(DARK);
  const heard = vi.fn();
  dark.addEventListener('change', heard);
  systemColorScheme.set(true);
  localStorage.setItem('cla.theme', 'dark');
  document.documentElement.setAttribute('data-theme', 'dark');
  heard.mockClear();

  resetThemeEnvironment();

  expect(systemColorScheme.dark).toBe(false);
  expect(window.matchMedia(DARK).matches).toBe(false);
  expect(localStorage).toHaveLength(0);
  expect(document.documentElement).not.toHaveAttribute('data-theme');
  systemColorScheme.set(true);
  expect(heard).not.toHaveBeenCalled();
});
