// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useEffect, useState } from 'react';

const SECOND_MS = 1000;

/**
 * The whole seconds left of a wait of `seconds` that started when `restartKey` last changed (a new error starts a new wait).
 * It ticks once a second and reads the clock at each tick, so a tab that was throttled in the background catches up instead of
 * running late. It stops at 0.
 */
export function useCountdown(seconds: number, restartKey: unknown): number {
  const [state, setState] = useState({ key: restartKey, remaining: seconds });
  if (state.key !== restartKey) {
    // The wait restarts in the same render that sees the new key, so no frame shows the old count against the new error.
    setState({ key: restartKey, remaining: seconds });
  }
  useEffect(() => {
    if (seconds === 0) {
      return undefined;
    }
    const deadline = Date.now() + seconds * SECOND_MS;
    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / SECOND_MS));
      setState({ key: restartKey, remaining });
      if (remaining === 0) {
        clearInterval(timer);
      }
    }, SECOND_MS);
    return () => {
      clearInterval(timer);
    };
  }, [seconds, restartKey]);
  return state.remaining;
}
