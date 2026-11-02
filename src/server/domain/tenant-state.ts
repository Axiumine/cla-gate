// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { InstallationState } from './eligibility.ts';

// What state a tenant is in for the purpose of access (E11-S07). Pure: the caller loads the stored installation and passes
// its state; nothing is read from GitHub, the database or the clock here. Retention is E05's job (nothing is deleted), so
// the four answers below only decide what a request may do:
//
//   rejected   the admission policy does not serve the account: the tenant is invisible, to its admins too
//   deleted    the App was uninstalled: GitHub refuses the tokens, so only the ledger of past admins can say who may read
//   suspended  GitHub suspended the installation: the same
//   active     roles are asked of GitHub, live

/** The four states of a tenant, in the order they are checked. */
export type TenantState = 'rejected' | 'deleted' | 'suspended' | 'active';

/**
 * The state of the tenant whose installation row reads `installation`. The first that applies wins: a rejected tenant is
 * `rejected` even when it was also uninstalled, and a tenant that was uninstalled while suspended is `deleted`, so the
 * answer names the outermost thing that is wrong, in the same order as the installation reasons of E05-S06
 * (`evaluationEligibility`), which a test holds this function to.
 */
export function tenantState(installation: InstallationState): TenantState {
  if (installation.admissionStatus === 'rejected') {
    return 'rejected';
  }
  if (installation.deletedAt !== null) {
    return 'deleted';
  }
  if (installation.suspendedAt !== null) {
    return 'suspended';
  }
  return 'active';
}
