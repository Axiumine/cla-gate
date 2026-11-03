// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { InstallationGoneError, InstallationNotAdmittedError, InstallationSuspendedError } from './github-errors.ts';

/**
 * True for the errors that say the installation is no longer served (E07-S04, E07-S05): it was deleted on GitHub, it is
 * suspended, or this instance does not admit it. A job that meets one has nothing left to do, and retrying it cannot help.
 */
export function isInstallationUnavailable(error: unknown): boolean {
  return (
    error instanceof InstallationNotAdmittedError ||
    error instanceof InstallationGoneError ||
    error instanceof InstallationSuspendedError
  );
}
