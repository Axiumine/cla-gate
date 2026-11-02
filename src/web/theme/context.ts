// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createContext, useContext } from 'react';
import type { ResolvedTheme, ThemeMode } from './model.ts';

/** What `ThemeProvider` supplies (E17-S05). */
export interface ThemeValue {
  /** What the person chose: `system`, `light` or `dark`. */
  readonly mode: ThemeMode;
  /** What is on screen: `light` or `dark`. While the mode is `system` it follows the system preference as it changes. */
  readonly resolved: ResolvedTheme;
  /** Applies the mode to the page and remembers it, at once. */
  readonly setMode: (mode: ThemeMode) => void;
}

export const ThemeContext = createContext<ThemeValue | null>(null);

/** `{ mode, resolved, setMode }`: the theme the person chose and the one that is shown. */
export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error('The theme needs a ThemeProvider above the component');
  }
  return value;
}
