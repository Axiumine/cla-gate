// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * What the tenant holds about a person: the signatures (they stay), the rows of personal data kept for them and the
 * allowlist entries for their id (they stay, and the login shown with each is cleared).
 */
export interface ErasureCounts {
  readonly signatures: number;
  readonly signerPiiRows: number;
  readonly allowlistEntries: number;
}

/** Whether the tenant holds anything about the person: a signature or an allowlist entry, which an account that never signed is listed by. */
export function holdsAnythingAbout(counts: ErasureCounts): boolean {
  return counts.signatures > 0 || counts.allowlistEntries > 0;
}
