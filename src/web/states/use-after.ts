// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useEffect, useState } from 'react';

/** Whether `delayMs` have passed since the component appeared. It is false until then, and the timer dies with the component. */
export function useAfter(delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setElapsed(true);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [delayMs]);
  return elapsed;
}
