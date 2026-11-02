// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';
import { type InstallationIneligibleReason, installationEligibility } from '../domain/eligibility.ts';
import type { InstallationRow } from './installation-state.ts';
import { InstallationNotAdmittedError, type NotAdmittedReason } from './ports/github-errors.ts';
import { closedGate, type InstallationGate } from './ports/installation-gate.ts';

// The gate the installation token provider asks (E05-S03) before it hands out or mints a token: the instance serves an
// installation only when the stored row says so. Whatever the policy decided is already in the row (E05-S07), so this
// reads the row and nothing else, and refuses before any request to GitHub is made.

/** What each reason of the domain is called at the gate. */
const GATE_REASONS: Readonly<Record<InstallationIneligibleReason, NotAdmittedReason>> = {
  installation_rejected: 'rejected',
  installation_deleted: 'deleted',
  installation_suspended: 'suspended',
};

/**
 * The gate over stored installations. `find` reads the row by GitHub installation id. An installation with no row is
 * `unknown`, one the policy rejected (or never decided: the default is rejected) is `rejected`, then `deleted`, then
 * `suspended`, in the order the evaluation checks them. A failing read is not caught, so a database error refuses the
 * call too: the gate fails closed.
 */
export function createStoredGate(
  find: (githubInstallationId: GithubId) => Promise<InstallationRow | null>,
): InstallationGate {
  return {
    async assertAdmitted(githubInstallationId) {
      const row = await find(githubInstallationId);
      if (row === null) {
        throw new InstallationNotAdmittedError('unknown');
      }
      const served = installationEligibility({
        admissionStatus: row.admission_status,
        deletedAt: row.deleted_at,
        suspendedAt: row.suspended_at,
      });
      if (!served.eligible) {
        throw new InstallationNotAdmittedError(GATE_REASONS[served.reason]);
      }
    },
  };
}

/**
 * A gate that is handed to the GitHub client before the database is open (the start-up self-check comes first, so
 * nothing else is opened when it fails) and bound to the real one afterwards. Until then it is the closed gate, so a
 * call that came in between would be refused.
 */
export class LateBoundGate implements InstallationGate {
  #gate: InstallationGate = closedGate;

  bind(gate: InstallationGate): void {
    this.#gate = gate;
  }

  assertAdmitted(githubInstallationId: GithubId): Promise<void> {
    return this.#gate.assertAdmitted(githubInstallationId);
  }
}
