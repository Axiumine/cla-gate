// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * A new worker for one render, or `undefined` where the browser has no workers or refuses to start one (the page then shows the text as
 * it was written). The worker is a module of the app's own origin, which the Content-Security-Policy (`script-src 'self'`) allows.
 */
export function startRenderWorker(): Worker | undefined {
  if (typeof Worker === 'undefined') {
    return undefined;
  }
  try {
    return new Worker(new URL('./render-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return undefined;
  }
}
