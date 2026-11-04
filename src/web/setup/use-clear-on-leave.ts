// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useEffect } from 'react';

/**
 * Runs `clear` when the component unmounts and when the page is hidden (`pagehide`: a navigation away, a tab that is closed,
 * a page that goes into the back/forward cache). The credentials page uses it to drop the mutation result that holds them
 * (E19-S07), so they are not in memory in a page the person has left, and a page restored from the cache does not show them.
 */
export function useClearOnLeave(clear: () => void): void {
  useEffect(() => {
    window.addEventListener('pagehide', clear);
    return () => {
      window.removeEventListener('pagehide', clear);
      clear();
    };
  }, [clear]);
}
