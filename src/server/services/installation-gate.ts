// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';
import { decideAccountAdmission } from '../domain/admission.ts';
import { type InstallationIneligibleReason, installationEligibility } from '../domain/eligibility.ts';
import type { AdmissionPolicies } from './admission-policies.ts';
import type { InstallationRow } from './installation-state.ts';
import { InstallationNotAdmittedError, type NotAdmittedReason } from './ports/github-errors.ts';
import { closedGate, type InstallationGate } from './ports/installation-gate.ts';

// The gate the installation token provider asks (E05-S03) before it hands out or mints a token: the instance serves an
// installation only when the stored row says so AND the policy in force now still serves its account. The row holds
// what the last sync decided (E05-S07); the policy is asked again on every call, so an account the operator removed
// from GITHUB_ALLOWED_ACCOUNT_IDS stops being served at the next start, before any reconciliation has re-decided the row
// (a reconciliation that fails, or has not run yet, leaves the row stale). Both are checked before any request to GitHub.

/** What each reason of the domain is called at the gate. */
const GATE_REASONS: Readonly<Record<InstallationIneligibleReason, NotAdmittedReason>> = {
  installation_rejected: 'rejected',
  installation_deleted: 'deleted',
  installation_suspended: 'suspended',
};

/** What the row says, unless the policy in force no longer serves its account. A stored refusal needs no policy. */
async function admissionNow(
  row: InstallationRow,
  policies: Pick<AdmissionPolicies, 'current'>,
): Promise<InstallationRow['admission_status']> {
  if (row.admission_status !== 'admitted') {
    return row.admission_status;
  }
  const policy = await policies.current();
  return decideAccountAdmission({ id: row.account_id, type: row.account_type }, policy).admitted
    ? 'admitted'
    : 'rejected';
}

/**
 * The gate over stored installations. `find` reads the row by GitHub installation id. An installation with no row is
 * `unknown`, one the policy rejected (or never decided: the default is rejected) is `rejected`, then `deleted`, then
 * `suspended`, in the order the evaluation checks them. A row that says `admitted` is also checked against the policy
 * in force now (`policies.current()`, held in memory): an account it no longer serves is `rejected` too, and a policy
 * that cannot be built yet (the App owner is not known) refuses with that failure. A failing read is not caught, so a
 * database error refuses the call too: the gate fails closed.
 */
export function createStoredGate(
  find: (githubInstallationId: GithubId) => Promise<InstallationRow | null>,
  policies: Pick<AdmissionPolicies, 'current'>,
): InstallationGate {
  return {
    async assertAdmitted(githubInstallationId) {
      const row = await find(githubInstallationId);
      if (row === null) {
        throw new InstallationNotAdmittedError('unknown');
      }
      const served = installationEligibility({
        admissionStatus: await admissionNow(row, policies),
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
