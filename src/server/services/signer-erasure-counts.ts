// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * What the tenant holds about a person: the signatures (they stay), the rows of personal data kept for them, the
 * allowlist entries for their id (they stay, and the login shown with each is cleared) and the approvals of a corporate
 * agreement that name them (E21-S03; they stay, and the login snapshot kept with each is deleted).
 */
export interface ErasureCounts {
  readonly signatures: number;
  readonly signerPiiRows: number;
  readonly allowlistEntries: number;
  readonly corporateApprovals: number;
}

/**
 * Whether the tenant holds anything about the person: a signature, an allowlist entry or a corporate approval, which an account that
 * never signed is listed or approved by.
 */
export function holdsAnythingAbout(counts: ErasureCounts): boolean {
  return counts.signatures > 0 || counts.allowlistEntries > 0 || counts.corporateApprovals > 0;
}
