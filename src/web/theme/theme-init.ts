// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { applyTheme, resolveTheme, systemPreference } from './model.ts';
import { readThemeMode } from './storage.ts';

// The script that index.html loads in <head>, before the stylesheet and the app (E17-S05). It is a blocking classic script
// and not a module, so it runs before the first paint and the page never shows the wrong theme for a moment, and a file
// and not an inline script, so the Content-Security-Policy needs no 'unsafe-inline'. The build bundles it alone into
// theme-init.js, without a hash, because index.html names it (scripts/web/theme-init-build.ts). It does what ThemeProvider
// does at mount, with no React: stored mode, system preference, `data-theme`.
applyTheme(resolveTheme(readThemeMode(), systemPreference().matches));
