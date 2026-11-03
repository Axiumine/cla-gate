// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// What a theme is (E17-S05), in the code that both the page head (theme-init.ts, a classic script) and the app share. It
// imports nothing, so the script stays a few hundred bytes.

/** What a person chooses: follow the system, or force one of the two themes. */
export const THEME_MODES = ['system', 'light', 'dark'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/** The theme that is on screen: `data-theme` on <html> holds one of these, never `system`. */
export type ResolvedTheme = 'light' | 'dark';

export const DEFAULT_THEME_MODE: ThemeMode = 'system';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Narrows a stored or received value to a mode; anything else, a tampered storage entry included, is not one. */
export function isThemeMode(value: unknown): value is ThemeMode {
  return THEME_MODES.some((mode) => mode === value);
}

/** The media query list of the system preference: `matches` is true while the system asks for dark. */
export function systemPreference(): MediaQueryList {
  return window.matchMedia(DARK_QUERY);
}

/** The theme a mode shows given the system preference: `system` follows it, the other two ignore it. */
export function resolveTheme(mode: ThemeMode, systemDark: boolean): ResolvedTheme {
  if (mode === 'system') {
    return systemDark ? 'dark' : 'light';
  }
  return mode;
}

/** Puts the theme on <html>, where tokens.css reads it: the colour tokens and `color-scheme` follow `data-theme`. */
export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.setAttribute('data-theme', theme);
}
