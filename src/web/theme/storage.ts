// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { DEFAULT_THEME_MODE, isThemeMode, type ThemeMode } from './model.ts';

// The only module of src/web that touches Web Storage (E17-S05; ESLint bars it everywhere else, E17-S04). It keeps one
// key, `cla.theme`, whose value is the name of a theme mode and nothing else: no token, no session data, no other key.

const THEME_STORAGE_KEY = 'cla.theme';

/**
 * The mode the person chose last. Storage can be missing, blocked or full (a private window, a policy, an embedded view),
 * and what it holds is whatever any script of the origin put there, so every access sits in try/catch and a value that is
 * not a mode is ignored, not repaired: either way the mode is `system` and the app works.
 */
export function readThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : DEFAULT_THEME_MODE;
  } catch {
    return DEFAULT_THEME_MODE;
  }
}

/** Remembers the choice. When storage refuses, the choice still holds for this page, and the next visit starts on `system`. */
export function writeThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Nothing else to do: the theme is applied by the caller, and a preference is not worth an error.
  }
}
