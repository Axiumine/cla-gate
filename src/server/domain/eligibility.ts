// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// Whether a repository may be evaluated at all (E05-S06). Pure: the caller loads the stored installation and repository
// and passes their state; nothing is read from GitHub or the clock here. An evaluation, a sweep and a Check Run each
// start from this answer, so a rejected, uninstalled or suspended installation, a removed repository and a repository
// whose enforcement is off are all stopped in one place, in one fixed order.

/** A stored timestamp or `null`; this module only asks whether it is set and never reads the instant. */
type Instant = object;

/** The state of an installation row that decides whether its repositories are evaluated. */
export interface InstallationState {
  /** `rejected` is the stored default: an installation nobody admitted is never evaluated. */
  readonly admissionStatus: 'admitted' | 'rejected';
  /** Set when the App was uninstalled. */
  readonly deletedAt: Instant | null;
  /** Set while the installation is suspended on GitHub. */
  readonly suspendedAt: Instant | null;
}

/** The state of a repository row that decides whether it is evaluated. */
export interface RepositoryState {
  /** Set when GitHub no longer lists the repository for the installation. */
  readonly removedAt: Instant | null;
  /** Enforcement is off until a maintainer turns it on. */
  readonly enabled: boolean;
}

/** Why a repository is not evaluated, in the order the reasons are checked. */
export const INELIGIBLE_REASONS = [
  'installation_rejected',
  'installation_deleted',
  'installation_suspended',
  'repository_removed',
  'repository_disabled',
] as const;

export type IneligibleReason = (typeof INELIGIBLE_REASONS)[number];

export type Eligibility = { readonly eligible: true } | { readonly eligible: false; readonly reason: IneligibleReason };

/** The reasons that belong to the installation itself: the first three of {@link INELIGIBLE_REASONS}. */
export type InstallationIneligibleReason = Extract<
  IneligibleReason,
  'installation_rejected' | 'installation_deleted' | 'installation_suspended'
>;

export type InstallationEligibility =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: InstallationIneligibleReason };

/**
 * The installation half of {@link evaluationEligibility}: whether the instance serves the installation at all, in the
 * same order. The installation gate (E05-S07) asks this before any request to GitHub, so the gate and the evaluation
 * stop an installation for the same reason.
 */
export function installationEligibility(installation: InstallationState): InstallationEligibility {
  if (installation.admissionStatus !== 'admitted') {
    return { eligible: false, reason: 'installation_rejected' };
  }
  if (installation.deletedAt !== null) {
    return { eligible: false, reason: 'installation_deleted' };
  }
  if (installation.suspendedAt !== null) {
    return { eligible: false, reason: 'installation_suspended' };
  }
  return { eligible: true };
}

/**
 * The first reason, in the order of {@link INELIGIBLE_REASONS}, why `repository` of `installation` is not evaluated, or
 * eligible. Installation facts come before repository facts and rejection before everything else, so the reason names
 * the outermost thing that is wrong: a rejected installation is reported as rejected even when it was also uninstalled.
 */
export function evaluationEligibility(installation: InstallationState, repository: RepositoryState): Eligibility {
  const served = installationEligibility(installation);
  if (!served.eligible) {
    return served;
  }
  if (repository.removedAt !== null) {
    return { eligible: false, reason: 'repository_removed' };
  }
  if (!repository.enabled) {
    return { eligible: false, reason: 'repository_disabled' };
  }
  return { eligible: true };
}
