// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type ReactNode, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ThemeContext, type ThemeValue } from './context.ts';
import { applyTheme, resolveTheme, systemPreference, type ThemeMode } from './model.ts';
import { readThemeMode, writeThemeMode } from './storage.ts';

export interface ThemeProviderProps {
  readonly children: ReactNode;
}

/** Calls `notify` whenever the system switches between light and dark, and stops when the returned function is called. */
function subscribeToSystem(notify: () => void): () => void {
  const preference = systemPreference();
  preference.addEventListener('change', notify);
  return () => {
    preference.removeEventListener('change', notify);
  };
}

function systemPrefersDark(): boolean {
  return systemPreference().matches;
}

/**
 * Supplies `useTheme()` to everything below it (E17-S05). The mode starts from the stored choice (`system` when there is
 * none, or storage fails), `data-theme` on <html> always holds the resolved theme, and while the mode is `system` the
 * resolved theme follows the system preference live, through the media query's change event.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(readThemeMode);
  const systemDark = useSyncExternalStore(subscribeToSystem, systemPrefersDark);
  const resolved = resolveTheme(mode, systemDark);
  // The page head already did this before the first paint; here it follows the system while the mode is `system`.
  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);
  const setMode = useCallback((next: ThemeMode) => {
    writeThemeMode(next);
    applyTheme(resolveTheme(next, systemPrefersDark()));
    setModeState(next);
  }, []);
  const value = useMemo<ThemeValue>(() => ({ mode, resolved, setMode }), [mode, resolved, setMode]);
  return <ThemeContext value={value}>{children}</ThemeContext>;
}
