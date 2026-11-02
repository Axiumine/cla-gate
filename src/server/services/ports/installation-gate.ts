// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import { InstallationNotAdmittedError } from './github-errors.ts';

/**
 * Whether the instance serves an installation (E05-S03). The installation token provider asks before every token it
 * hands out or mints, so a rejected, deleted, suspended or unknown installation never reaches GitHub. The stored-row
 * implementation is the admission policy of E05-S07.
 */
export interface InstallationGate {
  /** @throws InstallationNotAdmittedError when the installation is not served; resolves otherwise. */
  assertAdmitted(githubInstallationId: GithubId): Promise<void>;
}

/** The gate used when none is wired: it refuses every installation, so a missing wiring fails closed. */
export const closedGate: InstallationGate = {
  assertAdmitted: () => Promise.reject(new InstallationNotAdmittedError('not_wired')),
};
