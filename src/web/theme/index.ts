// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// What the rest of the app imports for the theme (E17-S05). A Knip production entry until the user menu of E17-S09 imports
// `useTheme` from production code; then remove the entry from knip.json.
export { type ThemeValue, useTheme } from './context.ts';
export { type ResolvedTheme, THEME_MODES, type ThemeMode } from './model.ts';
export { ThemeProvider, type ThemeProviderProps } from './ThemeProvider.tsx';
