// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { InstallationSync } from './services/installation-sync.ts';

/**
 * Runs the reconciliation of E05-S08 once, in the background, and never rejects: the server is already listening, and a
 * failure (GitHub unreachable, a list that cannot be read) is logged as `installation.reconcile_failed` and left for the
 * next sweep (E07-S08), which runs it on a schedule. The returned promise settles when the run is over; boot hands it to
 * the caller so a test can wait for it. Without a sync (no GitHub App is configured) there is nothing to run: undefined.
 */
export function reconcileInBackground(sync: InstallationSync | undefined, logger: Logger): Promise<void> | undefined {
  return sync?.reconcileInstallations().then(
    () => undefined,
    (error: unknown) => {
      logger.warn({ err: error }, 'installation.reconcile_failed');
    },
  );
}
